use std::sync::Arc;
use crate::sampler::Sample;

pub struct Voice {
    pub sample: Arc<Sample>,
    pub path: String,
    pub position: f64, 
    pub increment: f64,
    pub note: u8,
    pub stop_id: String,
    pub gain: f32, // Final gain (base * pedal_scale)
    pub pedal_scale: f32, // Stored pedal scale factor
    pub pitch_factor: f32, // Stored pitch shift factor
    pub state: VoiceState,
    pub envelope: f32,
    pub attack_samples: f32,
    pub samples_since_start: f32,
    pub release_samples: f32,
    pub samples_since_release: f32,
    pub release_path: Option<String>, 
    pub harmonic_number: f32,
    pub pitch_offset_cents: f32,
    pub rendering_note: u8,
    pub is_release: bool,
}

#[derive(Clone, Copy, PartialEq)] // Added derives for easier comparisons
pub enum VoiceState {
    Playing,
    Releasing,
    Finished,
}

impl Voice {
    pub fn new(
        sample: Arc<Sample>, 
        path: String,
        note: u8, 
        output_sample_rate: f32, 
        is_pedal: bool, 
        release_path: Option<String>,
        attack_time: f32,
        release_time: f32,
        manual_pitch_factor: Option<f32>,
        harmonic_number: f32,
        pitch_offset_cents: f32,
        rendering_note: Option<u8>,
        is_release: bool,
    ) -> Self {
        // Calculate pitch shift
        let mut pitch_src_factor = 1.0;
        
        let actual_rendering_note = rendering_note.unwrap_or(note);

        if let Some(pf) = manual_pitch_factor {
            pitch_src_factor = pf;
        } else {
             // Calculate wav tuning based on unity note and fine tune (pitch fraction)
             let mut wav_tuning = 0.0;
             if let Some(target_root) = sample.root_note {
                 wav_tuning = (actual_rendering_note as i32 - target_root as i32) as f32 * 100.0;
                 if let Some(ft) = sample.fine_tune {
                      wav_tuning -= ft; // JS uses `- fractionCents`
                 }
             }

             // Harmonic adjustment: 1200 * log2(harmonicNumber)
             let harmonic_cents = 1200.0 * harmonic_number.log2();
             
             // Total tuning
             let total_cents = wav_tuning + harmonic_cents + pitch_offset_cents;
             log::info!("Note: {}, Root: {:?}, WavTuning: {}, Harmonic: {}, HarmonicCents: {}, TotalCents: {}", note, sample.root_note, wav_tuning, harmonic_number, harmonic_cents, total_cents);
             pitch_src_factor = 2.0_f32.powf(total_cents / 1200.0);
        }

        let playback_rate = (sample.sample_rate as f32 / output_sample_rate) * pitch_src_factor;

        // Pedal Scaling Logic
        let mut pedal_scale = 1.0;
        if is_pedal {
             // 1.0 at note 36 (C2), 0.0 at note 60 (C4)
             let scale = 1.0 - (note as f32 - 36.0) * (1.0 / 24.0);
             pedal_scale = scale.clamp(0.0, 1.0);
        }

        Self {
            sample,
            path,
            position: 0.0,
            increment: playback_rate as f64, 
            note,
            stop_id: String::new(), // Will be updated if needed or just use from sample
            gain: 1.0 * pedal_scale, // Initial gain
            pedal_scale,
            pitch_factor: pitch_src_factor,
            state: VoiceState::Playing,
            envelope: 0.0,
            attack_samples: attack_time * output_sample_rate,
            samples_since_start: 0.0,
            release_samples: release_time * output_sample_rate,
            samples_since_release: 0.0,
            release_path,
            harmonic_number,
            pitch_offset_cents,
            rendering_note: actual_rendering_note,
            is_release,
        }
    }

    pub fn is_note(&self, note: u8, stop_id: &str) -> bool {
        self.note == note && self.sample.stop_id == stop_id
    }

    pub fn set_gain(&mut self, gain: f32) {
        // Apply pedal scaling to the input gain
        self.gain = gain * self.pedal_scale;
    }

    pub fn release(&mut self) {
        if let VoiceState::Playing = self.state {
            self.state = VoiceState::Releasing;
        }
    }

    pub fn swap_sample(&mut self, new_sample: Arc<Sample>, output_sample_rate: f32) {
        // Keep position but update increment based on new sample rate
        self.sample = new_sample;
        let playback_rate = (self.sample.sample_rate as f32 / output_sample_rate) * self.pitch_factor;
        self.increment = playback_rate as f64;
    }

    pub fn is_finished(&self) -> bool {
        matches!(self.state, VoiceState::Finished)
    }
    
    // Helper to safely get sample at index, handling loops and bounds
    fn get_sample_at(&self, channel_data: &[f32], idx: isize) -> f32 {
        let len = channel_data.len() as isize;
        // Handle Loop
        if let Some(loop_point) = self.sample.loop_point {
            let loop_start = loop_point.start as isize;
            let loop_end = loop_point.end as isize;
            let loop_len = loop_end - loop_start;
            
            if idx >= loop_end {
                // Wrap around
                 let offset = idx - loop_end;
                 let wrapped_idx = loop_start + (offset % loop_len);
                 return *channel_data.get(wrapped_idx as usize).unwrap_or(&0.0);
            }
        }
        
        // Clamping / Zero padding
        if idx < 0 {
            return *channel_data.first().unwrap_or(&0.0);
        } else if idx >= len {
            return 0.0; // Return 0 for silence after end
            // Or clamp to last value:
            // return *channel_data.last().unwrap_or(&0.0);
        }
        
        *channel_data.get(idx as usize).unwrap_or(&0.0)
    }

    pub fn next_sample(&mut self) -> (f32, f32) {
        if self.is_finished() {
            return (0.0, 0.0);
        }

        // Check bounds before interpolation to detect finish
        let pos_floor = self.position.floor();
        let len = if !self.sample.data.is_empty() { self.sample.data[0].len() } else { 0 };
        
        // End condition (if not looping)
        if self.sample.loop_point.is_none() && pos_floor as usize >= len {
            self.state = VoiceState::Finished;
            return (0.0, 0.0);
        }
        
        // Loop bound check for safety (handled in get_sample_at, but we need to wrap `position` eventually to avoid float precision loss?)
        if let Some(loop_point) = self.sample.loop_point {
             if self.position >= loop_point.end as f64 {
                 self.position = loop_point.start as f64 + (self.position - loop_point.end as f64);
             }
        }

        let channel_data = &self.sample.data;
        if channel_data.is_empty() { return (0.0, 0.0); }
        
        let idx = self.position.floor() as isize;
        let frac = (self.position - idx as f64) as f32;

        let val_l;
        let val_r;

        {
            let channel0 = &channel_data[0];
            let y0 = self.get_sample_at(channel0, idx - 1);
            let y1 = self.get_sample_at(channel0, idx);
            let y2 = self.get_sample_at(channel0, idx + 1);
            let y3 = self.get_sample_at(channel0, idx + 2);
            
            let a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
            let b = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
            let c = -0.5 * y0 + 0.5 * y2;
            let d = y1;
            val_l = a * frac * frac * frac + b * frac * frac + c * frac + d;
        }

        if channel_data.len() >= 2 {
            let channel1 = &channel_data[1];
            let y0 = self.get_sample_at(channel1, idx - 1);
            let y1 = self.get_sample_at(channel1, idx);
            let y2 = self.get_sample_at(channel1, idx + 1);
            let y3 = self.get_sample_at(channel1, idx + 2);
            
            let a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
            let b = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
            let c = -0.5 * y0 + 0.5 * y2;
            let d = y1;
            val_r = a * frac * frac * frac + b * frac * frac + c * frac + d;
        } else {
            val_r = val_l;
        }

        let output_l = val_l * self.gain * self.envelope;
        let output_r = val_r * self.gain * self.envelope;

        // Advance
        self.position += self.increment;

        // Envelope Logic
        match self.state {
            VoiceState::Playing => {
                if self.samples_since_start < self.attack_samples {
                    self.samples_since_start += 1.0;
                    self.envelope = (self.samples_since_start / self.attack_samples).min(1.0);
                } else {
                    self.envelope = 1.0;
                }
            }
            VoiceState::Releasing => {
                self.samples_since_release += 1.0;
                let env = 1.0 - (self.samples_since_release / self.release_samples);
                if env <= 0.0 {
                    self.envelope = 0.0;
                    self.state = VoiceState::Finished;
                } else {
                    self.envelope = env;
                }
            }
            VoiceState::Finished => {
                self.envelope = 0.0;
            }
        }
        
        (output_l, output_r)
    }
}
