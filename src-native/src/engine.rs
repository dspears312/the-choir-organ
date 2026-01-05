use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::Receiver;
use std::sync::Arc;
use log::{info, error};
use crate::sampler::Sampler;
use crate::voice::Voice;
use rayon::prelude::*;


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
        pitch_offset: f32,
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
    pub global_gain: f32,
    pub release_mode: String,
    pub loading_mode: String,
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

        let rx = self.command_receiver.clone();
        let sampler = self.sampler.clone();
        
        let mut voices: Vec<Voice> = Vec::with_capacity(512);
        let mut global_gain = self.global_gain;
        let mut release_mode = self.release_mode.clone();
        let mut loading_mode = self.loading_mode.clone();

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
                            note, stop_id, path, release_path, gain, 
                            pitch_offset,
                        } => {
                            for voice in voices.iter_mut() {
                                if voice.is_note(note, &stop_id) {
                                    if voice.state != crate::voice::VoiceState::Finished {
                                        voice.release_samples = 0.01 * sample_rate;
                                        voice.state = crate::voice::VoiceState::Releasing;
                                        voice.samples_since_release = 0.0;
                                    }
                                }
                            }

                            if let Some(sample) = sampler.get_sample(&stop_id, &path) {
                                let voice = Voice::new(
                                    sample, path, note, sample_rate, gain, release_path, 
                                    0.005, 0.2, None, pitch_offset, 
                                    false,
                                );
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
                                                 sample, voice.release_path.as_ref().unwrap().clone(),
                                                 note, sample_rate, voice.gain, None, crossfade_time, 0.2, 
                                                 Some(voice.pitch_factor), 
                                                 voice.pitch_offset, true,
                                             );
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

                // 2. Auto-Swap
                for voice in voices.iter_mut() {
                    if !voice.sample.is_full {
                         if let Some(full_sample) = sampler.get_sample(&voice.sample.stop_id, &voice.path) {
                             if full_sample.is_full {
                                 voice.swap_sample(full_sample, sample_rate);
                             }
                         }
                    }
                }
                voices.append(&mut new_voices);

                // 3. Render
                data.fill(0.0);
                if !voices.is_empty() {
                    if voices.len() > 32 {
                        let block_size = data.len();
                        let mixed_data = voices.par_iter_mut()
                            .fold(|| vec![0.0; block_size], |mut acc, voice| {
                                voice.render_into(&mut acc, channels);
                                acc
                            })
                            .reduce(|| vec![0.0; block_size], |mut a, b| {
                                for i in 0..block_size { a[i] += b[i]; }
                                a
                            });
                        data.copy_from_slice(&mixed_data);
                    } else {
                        for voice in voices.iter_mut() {
                            voice.render_into(data, channels);
                        }
                    }
                }

                if global_gain != 1.0 {
                    for sample in data.iter_mut() { *sample *= global_gain; }
                }

                // 4. Cleanup
                let mut finished_voices = Vec::new();
                voices.retain(|voice| {
                    if voice.is_finished() {
                        if loading_mode == "none" { finished_voices.push((voice.stop_id.clone(), voice.path.clone())); }
                        false
                    } else { true }
                });
                for (sid, path) in finished_voices { sampler.unload_sample(&sid, &path); }

                // 5. Reporting
                static mut SAMPLE_COUNT: usize = 0;
                unsafe {
                    SAMPLE_COUNT += data.len() / (channels + 1).min(1); // avoid div by zero
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
        loop { std::thread::sleep(std::time::Duration::from_millis(1000)); }
    }
}
