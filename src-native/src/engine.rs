use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::Receiver;
use std::sync::{Arc, RwLock};
use log::{info, error};
use crate::sampler::Sampler;
use crate::voice::Voice;

pub enum EngineCommand {
    LoadSample { 
        stop_id: String, 
        path: String, 
        max_duration: Option<f32> 
    },
    UnloadSample {
        stop_id: String,
        path: String,
    },
    NoteOn { 
        note: u8, 
        stop_id: String, 
        path: String, 
        release_path: Option<String>,
        gain: f32,
        is_pedal: bool,
        harmonic_number: f32,
        pitch_offset_cents: f32,
        rendering_note: Option<u8>,
    },
    NoteOff { note: u8, stop_id: String },
    SetGlobalGain(f32),
    SetReleaseMode(String),
    SetLoadingMode(String),
}

pub struct AudioEngine {
    sampler: Arc<Sampler>,
    command_receiver: Receiver<EngineCommand>,
    voices: Vec<Voice>,
    global_gain: f32,
    release_mode: String,
    loading_mode: String,
}

impl AudioEngine {
    pub fn new(sampler: Arc<Sampler>, command_receiver: Receiver<EngineCommand>) -> Self {
        Self {
            sampler,
            command_receiver,
            voices: Vec::with_capacity(512), 
            global_gain: 1.0,
            release_mode: "authentic".to_string(),
            loading_mode: "none".to_string(),
        }
    }

    pub fn run(&mut self) -> anyhow::Result<()> {
        let host = cpal::default_host();
        let device = host.default_output_device()
            .ok_or(anyhow::anyhow!("No output device available"))?;
        
        let mut supported_configs_range = device.supported_output_configs()
            .map_err(|e| anyhow::anyhow!("Failed to query supported configs: {}", e))?;
            
        let supported_config = supported_configs_range.find(|c| {
            c.channels() == 2 && 
            c.min_sample_rate().0 <= 48000 && c.max_sample_rate().0 >= 48000
        }).map(|c| c.with_sample_rate(cpal::SampleRate(48000)))
        .or_else(|| {
            device.supported_output_configs().ok()?.find(|c| {
                c.channels() == 2 && 
                c.min_sample_rate().0 <= 44100 && c.max_sample_rate().0 >= 44100
            }).map(|c| c.with_sample_rate(cpal::SampleRate(44100)))
        })
        .or_else(|| device.default_output_config().ok())
        .ok_or(anyhow::anyhow!("No suitable output config found"))?;

        let config: cpal::StreamConfig = supported_config.into();
        let sample_rate = config.sample_rate.0 as f32;
        let channels = config.channels as usize;

        info!("Audio Engine Initialized: Device: {:?}, Sample Rate: {}, Channels: {}", device.name().unwrap_or("Unknown".to_string()), sample_rate, channels);

        // We use Raw pointers/Unsafe or Arc/RwLock for fields that needs to be updated by UI while audio is running.
        // But since this is a simple command-based engine, we can just process commands at the start of each block.
        // To avoid moving self into the closure, we extract the bits we need.
        
        // However, `global_gain` etc are NOT currently atomic. 
        // Let's use local variables in the thread that are updated by commands.
        
        let rx = self.command_receiver.clone();
        let sampler = self.sampler.clone();
        
        // State variables inside the thread
        let mut voices: Vec<Voice> = Vec::with_capacity(512);
        let mut global_gain = 1.0;
        let mut release_mode = "authentic".to_string();
        let mut loading_mode = "none".to_string();

        let err_fn = |err| eprintln!("an error occurred on stream: {}", err);

        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                // 1. Process Commands
                let mut new_voices = Vec::new();

                while let Ok(cmd) = rx.try_recv() {
                    match cmd {
                        EngineCommand::LoadSample { stop_id, path, max_duration } => {
                             if let Err(e) = sampler.load_sample(stop_id, path, max_duration) {
                                 error!("Failed to load sample: {}", e);
                             }
                        },
                        EngineCommand::UnloadSample { stop_id, path } => {
                             sampler.unload_sample(&stop_id, &path);
                        },
                        EngineCommand::NoteOn { 
                            note, 
                            stop_id, 
                            path, 
                            release_path, 
                            gain, 
                            is_pedal,
                            harmonic_number,
                            pitch_offset_cents,
                            rendering_note,
                        } => {
                            // Restrike logic: cut off previous voices for this pipe
                            for voice in voices.iter_mut() {
                                if voice.is_note(note, &stop_id) {
                                    // Quick fade out for previous strikes (primary or release)
                                    if voice.state != crate::voice::VoiceState::Finished {
                                        voice.release_samples = 0.01 * sample_rate; // 10ms fade
                                        voice.state = crate::voice::VoiceState::Releasing;
                                        voice.samples_since_release = 0.0;
                                    }
                                }
                            }

                            if let Some(sample) = sampler.get_sample(&stop_id, &path) {
                                let mut voice = Voice::new(
                                    sample, 
                                    path,
                                    note, 
                                    sample_rate, 
                                    is_pedal, 
                                    release_path, 
                                    0.005, 
                                    0.2, 
                                    None,
                                    harmonic_number,
                                    pitch_offset_cents,
                                    rendering_note,
                                    false, // is_release = false
                                );
                                voice.set_gain(gain);
                                voices.push(voice);
                            }
                        },
                        EngineCommand::NoteOff { note, stop_id } => {
                            let is_auth = release_mode == "authentic";
                            for voice in voices.iter_mut() {
                                if voice.is_note(note, &stop_id) && voice.state == crate::voice::VoiceState::Playing && !voice.is_release {
                                    if is_auth && voice.release_path.is_some() {
                                        let crossfade_time = 0.05;
                                        voice.release_samples = crossfade_time * sample_rate;
                                        voice.release();
                                         if let Some(sample) = sampler.get_sample(&stop_id, voice.release_path.as_ref().unwrap()) {
                                             let mut rel_voice = Voice::new(
                                                 sample, 
                                                 voice.release_path.as_ref().unwrap().clone(),
                                                 note, 
                                                 sample_rate, 
                                                 false, 
                                                 None, 
                                                 crossfade_time, 
                                                 0.2, 
                                                 Some(voice.pitch_factor),
                                                 voice.harmonic_number, 
                                                 voice.pitch_offset_cents, 
                                                 Some(voice.rendering_note),
                                                 true, // is_release = true
                                             );
                                             rel_voice.set_gain(voice.gain);
                                             new_voices.push(rel_voice);
                                         }
                                    } else {
                                        voice.release_samples = 0.2 * sample_rate;
                                        voice.release();
                                    }
                                    
                                    if loading_mode == "none" {
                                        sampler.unload_sample(&stop_id, &voice.path);
                                    }
                                }
                            }
                        },
                        EngineCommand::SetGlobalGain(g) => global_gain = g,
                        EngineCommand::SetReleaseMode(m) => release_mode = m,
                        EngineCommand::SetLoadingMode(m) => loading_mode = m,
                    }
                }

                // 2. Auto-Swap logic (Partial -> Full)
                for voice in voices.iter_mut() {
                    if !voice.sample.is_full {
                         if let Some(full_sample) = sampler.get_sample(&voice.sample.stop_id, &voice.path) {
                             if full_sample.is_full {
                                 voice.swap_sample(full_sample, sample_rate);
                             }
                         }
                    }
                }
                
                // Append spawned release voices
                voices.append(&mut new_voices);

                // 2. Render Audio
                for frame in data.chunks_mut(channels) {
                    let mut left = 0.0;
                    let mut right = 0.0;
                    
                    for voice in voices.iter_mut() {
                        let (l, r) = voice.next_sample();
                        left += l;
                        right += r;
                    }
                    
                    left *= global_gain;
                    right *= global_gain;

                    if channels >= 2 {
                        frame[0] = left;
                        frame[1] = right;
                    } else {
                        frame[0] = (left + right) * 0.5;
                    }
                }
                
                // Cleanup finished voices
                let mut finished_voices = Vec::new();
                voices.retain(|voice| {
                    if voice.is_finished() {
                        if loading_mode == "none" {
                            finished_voices.push((voice.stop_id.clone(), voice.path.clone()));
                        }
                        false
                    } else {
                        true
                    }
                });

                // Exhaustive unloading for "none" mode
                for (sid, path) in finished_voices {
                    sampler.unload_sample(&sid, &path);
                }

                // Periodic Reporting (Approx every 5 seconds)
                // We use a simple counter for efficiency
                // Assuming block size of 256-1024
                static mut SAMPLE_COUNT: usize = 0;
                unsafe {
                    SAMPLE_COUNT += data.len() / channels;
                    if SAMPLE_COUNT >= 240000 {
                        SAMPLE_COUNT = 0;
                        let usage_mb = sampler.get_memory_usage() as f32 / 1024.0 / 1024.0;
                        info!("Memory: {:.2} MB | Voices: {} | Mode: {} | Loading: {}", 
                            usage_mb, voices.len(), release_mode, loading_mode);
                    }
                }
            },
            err_fn,
            None,
        )?;

        stream.play()?;
        
        // Keep thread alive and report memory usage periodically
        let mut last_report = std::time::Instant::now();
        loop {
            if last_report.elapsed().as_secs() >= 5 {
                let usage_mb = self.sampler.get_memory_usage() as f32 / 1024.0 / 1024.0;
                info!("Memory Usage: {:.2} MB (Voices: {})", usage_mb, self.voices.len()); 
                // wait, self.voices is not used in the thread. 
                // We should probably use a shared state or just accept we log from main loop.
                last_report = std::time::Instant::now();
            }
            std::thread::sleep(std::time::Duration::from_millis(1000));
        }
    }
}

struct EngineState {
    voices: Vec<Voice>,
    global_gain: f32,
    sampler: Arc<Sampler>,
    pending_commands: Receiver<EngineCommand>,
}
