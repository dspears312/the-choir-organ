use std::sync::Arc;
use crate::sampler::Sample;

pub struct Voice {
    pub sample: Arc<Sample>,
    pub path: String,
    pub position: f64, 
    pub increment: f64,
    pub note: u8,
    pub stop_id: String,
    pub gain: f32, // Final gain (linear)
    pub pitch_factor: f32, // Stored pitch shift factor
    pub state: VoiceState,
    pub envelope: f32,
    pub attack_samples: f32,
    pub samples_since_start: f32,
    pub release_samples: f32,
    pub samples_since_release: f32,
    pub release_path: Option<String>, 
    pub pitch_offset: f32,
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
        gain: f32, 
        release_path: Option<String>,
        attack_time: f32,
        release_time: f32,
        manual_pitch_factor: Option<f32>,
        pitch_offset: f32,
        is_release: bool,
    ) -> Self {
        // Calculate pitch shift
        let pitch_src_factor;
        
        if let Some(pf) = manual_pitch_factor {
            pitch_src_factor = pf;
        } else {
             // Calculate wav tuning based on unity note and fine tune (pitch fraction)
             let mut wav_tuning = 0.0;
             if let Some(target_root) = sample.root_note {
                 wav_tuning = (note as i32 - target_root as i32) as f32 * 100.0;
                 log::info!("Voice DBG: Root {:?} -> {}", sample.root_note, wav_tuning);
                 if let Some(ft) = sample.fine_tune {
                      log::info!("Voice DBG: Root {:?} FT {} -> Subtracted", sample.root_note, ft);
                      wav_tuning -= ft; // JS uses `- fractionCents`
                 }
             }

             // Total tuning (harmonic/pedal/virtual logic handled in passed pitch_offset)
             let total_cents = wav_tuning + pitch_offset;
             log::info!("Note: {}, Root: {:?}, WavTuning: {}, PitchOffset: {}, TotalCents: {}", note, sample.root_note, wav_tuning, pitch_offset, total_cents);
             pitch_src_factor = 2.0_f32.powf(total_cents / 1200.0);
        }

        let playback_rate = (sample.sample_rate as f32 / output_sample_rate) * pitch_src_factor;

        Self {
            sample,
            path,
            position: 0.0,
            increment: playback_rate as f64, 
            note,
            stop_id: String::new(), // Will be updated if needed or just use from sample
            gain, 
            pitch_factor: pitch_src_factor,
            state: VoiceState::Playing,
            envelope: 0.0,
            attack_samples: attack_time * output_sample_rate,
            samples_since_start: 0.0,
            release_samples: release_time * output_sample_rate,
            samples_since_release: 0.0,
            release_path,
            pitch_offset,
            is_release,
        }
    }

    pub fn is_note(&self, note: u8, stop_id: &str) -> bool {
        self.note == note && self.sample.stop_id == stop_id
    }

    pub fn set_gain(&mut self, gain: f32) {
        self.gain = gain;
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
    fn get_sample_at(&self, idx: isize, channel: usize) -> f32 {
        let len = self.sample.get_len() as isize;
        // Handle Loop
        if let Some(loop_point) = self.sample.loop_point {
            let loop_start = loop_point.start as isize;
            let loop_end = loop_point.end as isize;
            let loop_len = loop_end - loop_start;
            
            if idx >= loop_end {
                // Wrap around
                 let offset = idx - loop_end;
                 let wrapped_idx = loop_start + (offset % loop_len);
                 return self.sample.get_sample(channel, wrapped_idx as usize);
            }
        }
        
        // Clamping / Zero padding
        if idx < 0 {
            return self.sample.get_sample(channel, 0);
        } else if idx >= len {
            return 0.0;
        }
        
        self.sample.get_sample(channel, idx as usize)
    }

    #[inline]
    pub fn next_sample(&mut self) -> (f32, f32) {
        if self.is_finished() {
            return (0.0, 0.0);
        }

        // Check bounds before interpolation to detect finish
        let pos_floor = self.position.floor();
        let len = self.sample.get_len();
        
        // End condition (if not looping)
        if self.sample.loop_point.is_none() && pos_floor as usize >= len {
            self.state = VoiceState::Finished;
            return (0.0, 0.0);
        }
        
        // Loop bound check for safety
        if let Some(loop_point) = self.sample.loop_point {
             if self.position >= loop_point.end as f64 {
                 self.position = loop_point.start as f64 + (self.position - loop_point.end as f64);
             }
        }

        let idx = self.position.floor() as isize;
        let frac = (self.position - idx as f64) as f32;

        let val_l;
        let val_r;

        {
            let y0 = self.get_sample_at(idx - 1, 0);
            let y1 = self.get_sample_at(idx, 0);
            let y2 = self.get_sample_at(idx + 1, 0);
            let y3 = self.get_sample_at(idx + 2, 0);
            
            let a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
            let b = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
            let c = -0.5 * y0 + 0.5 * y2;
            let d = y1;
            val_l = a * frac * frac * frac + b * frac * frac + c * frac + d;
        }

        let num_channels = match &self.sample.source {
            crate::sampler::SampleSource::InMemory(data) => data.len(),
            crate::sampler::SampleSource::Streaming { channels, .. } => *channels as usize,
        };

        if num_channels >= 2 {
            let y0_r = self.get_sample_at(idx - 1, 1);
            let y1_r = self.get_sample_at(idx, 1);
            let y2_r = self.get_sample_at(idx + 1, 1);
            let y3_r = self.get_sample_at(idx + 2, 1);

            let a = -0.5 * y0_r + 1.5 * y1_r - 1.5 * y2_r + 0.5 * y3_r;
            let b = y0_r - 2.5 * y1_r + 2.0 * y2_r - 0.5 * y3_r;
            let c = -0.5 * y0_r + 0.5 * y2_r;
            let d = y1_r;
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

    pub fn render_into(&mut self, data: &mut [f32], channels: usize) {
        if self.is_finished() { return; }
        
        for frame in data.chunks_mut(channels) {
            let (l, r) = self.next_sample();
            frame[0] += l;
            if channels >= 2 {
                frame[1] += r;
            }
            if self.is_finished() { break; }
        }
    }


}
