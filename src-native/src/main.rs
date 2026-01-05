use std::io::{self, BufRead};
use std::sync::Arc;
use std::thread;
use crossbeam_channel::{unbounded, Sender, Receiver};
use serde::Deserialize;
use log::{info, error};

mod engine;
mod voice;
mod sampler;

use engine::AudioEngine;
use sampler::Sampler;

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
#[serde(rename_all = "kebab-case")]
enum Command {
    #[serde(rename_all = "camelCase")]
    LoadSample { 
        stop_id: String,
        #[serde(alias = "pipePath")]
        path: String,
        max_duration: Option<f32>
    },
    #[serde(rename_all = "camelCase")]
    UnloadSample {
        stop_id: String,
        #[serde(alias = "pipePath")]
        path: String
    },

    #[serde(rename_all = "camelCase")]
    NoteOn {  
        note: u8, 
        stop_id: String, 
        #[serde(alias = "pipePath")]
        path: String, 
        release_path: Option<String>,
        gain: Option<f32>,
        pitch_offset: Option<f32>,
    },
    #[serde(rename_all = "camelCase")]
    NoteOff { note: u8, stop_id: String },
    #[serde(rename_all = "camelCase")]
    SetGlobalGain { db: f32 },
    #[serde(rename_all = "camelCase")]
    SetReleaseMode { mode: String },
    #[serde(rename_all = "camelCase")]
    SetLoadingMode { mode: String },
}

fn main() -> anyhow::Result<()> {
    env_logger::init();
    info!("Starting Rust Synth Engine...");

    let (cmd_tx, cmd_rx): (Sender<engine::EngineCommand>, Receiver<engine::EngineCommand>) = unbounded();
    
    // Initialize Sampler
    let sampler = Arc::new(Sampler::new());
    
    // Start Audio Thread
    let sampler_for_engine = sampler.clone();
    let _audio_thread = thread::spawn(move || {
        let mut engine = AudioEngine::new(sampler_for_engine, cmd_rx);
        if let Err(e) = engine.run() {
            error!("Audio engine error: {}", e);
        }
    });

    // Main Control Loop (Stdin)
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        if let Ok(line_str) = line {
            if line_str.trim().is_empty() { continue; }
            match serde_json::from_str::<Command>(&line_str) {
                Ok(cmd) => {
                    match cmd {
                    Command::LoadSample { stop_id, path, max_duration } => {
                         let _ = cmd_tx.send(engine::EngineCommand::LoadSample { stop_id, path, max_duration });
                    },
                    Command::UnloadSample { stop_id, path } => {
                         let _ = cmd_tx.send(engine::EngineCommand::UnloadSample { stop_id, path });
                    },
                    Command::NoteOn { 
                        note, 
                        stop_id, 
                        path, 
                        release_path, 
                        gain, 
                        pitch_offset, 
                    } => {
                        // On-the-fly Loading Fallback:
                        // Ensure main sample is loaded. `load_sample` returns immediately if already present.
                        if let Err(e) = sampler.load_sample(stop_id.clone(), path.clone(), None) {
                             error!("Failed to load sample on-the-fly: {}", e);
                             // We could continue, but engine will likely fail to find it.
                        }
                        
                        // Ensure release sample is loaded if needed
                        if let Some(ref r_path) = release_path {
                             if let Err(e) = sampler.load_sample(stop_id.clone(), r_path.clone(), None) {
                                 error!("Failed to load release sample on-the-fly: {}", e);
                             }
                        }

                        let _ = cmd_tx.send(engine::EngineCommand::NoteOn { 
                            note, 
                            stop_id, 
                            path, 
                            release_path,
                            gain: gain.unwrap_or(1.0),
                            pitch_offset: pitch_offset.unwrap_or(0.0),
                        });
                    },
                    Command::NoteOff { note, stop_id } => {
                        let _ = cmd_tx.send(engine::EngineCommand::NoteOff { note, stop_id });
                    },
                    Command::SetGlobalGain { db } => {
                        let _ = cmd_tx.send(engine::EngineCommand::SetGlobalGain(
                            10.0f32.powf(db / 20.0)
                        ));
                    },
                    Command::SetReleaseMode { mode } => {
                         let _ = cmd_tx.send(engine::EngineCommand::SetReleaseMode(mode));
                    },
                    Command::SetLoadingMode { mode } => {
                         let _ = cmd_tx.send(engine::EngineCommand::SetLoadingMode(mode));
                    }
                    }
                },
                Err(e) => error!("Failed to parse command: {} -> {}", line_str, e),
            }
        }
    }

    Ok(())
}
