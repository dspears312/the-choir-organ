use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use byteorder::{ReadBytesExt, LittleEndian};

#[derive(Clone, Copy)]
pub struct LoopPoint {
    pub start: u32,
    pub end: u32,
}

pub struct Sample {
    pub stop_id: String,
    pub data: Vec<Vec<f32>>, // Channels -> Samples
    pub sample_rate: u32,
    pub loop_point: Option<LoopPoint>,
    pub root_note: Option<u32>,
    pub fine_tune: Option<f32>,
    pub is_full: bool,
}

pub struct Sampler {
    buffers: RwLock<HashMap<String, Arc<Sample>>>, // Key: "stopId-path"
}

impl Sampler {
    pub fn new() -> Self {
        Self {
            buffers: RwLock::new(HashMap::new()),
        }
    }

    pub fn load_sample(&self, stop_id: String, path: String, max_duration: Option<f32>) -> anyhow::Result<()> {
        let key = format!("{}-{}", stop_id, path);
        
        // Check if we already have a full sample or if the existing partial is sufficient
        {
            let buffers = self.buffers.read().unwrap();
            if let Some(existing) = buffers.get(&key) {
                if existing.is_full {
                    return Ok(()); // Already have the best
                }
                if max_duration.is_some() && !existing.is_full {
                    return Ok(()); // Already have a partial, and partial requested
                }
                // Otherwise (asking for full but only have partial), proceed to reload.
            }
        }

        // Custom Manual WAV Loader (Merging Metadata + Audio Parsing)
        // This is tolerant to extra header bytes and weird chunk sizes.
        
        let mut file = File::open(&path)?;
        let mut buffer = [0u8; 12];
        file.read_exact(&mut buffer)?;

        if &buffer[0..4] != b"RIFF" || &buffer[8..12] != b"WAVE" {
             return Err(anyhow::anyhow!("Not a valid RIFF/WAVE file"));
        }

        let mut audio_data: Vec<Vec<f32>> = Vec::new();
        let mut sample_rate = 44100;
        let mut channels = 1;
        let mut bits_per_sample = 16;
        let mut audio_format = 1; // 1 = PCM, 3 = Float

        let mut loop_point = None;
        let mut root_note = None;
        let mut fine_tune = None;

        loop {
            let mut chunk_header = [0u8; 8];
            if file.read_exact(&mut chunk_header).is_err() { break; } // EOF

            let chunk_id = &chunk_header[0..4];
            let chunk_size = (&chunk_header[4..8]).read_u32::<LittleEndian>()?;

            if chunk_id == b"fmt " {
                let _fmt_start = file.stream_position()?;
                 // Expected min size 16.
                 // We read what we need, then skip valid remainder.
                 
                 audio_format = file.read_u16::<LittleEndian>()?;
                 channels = file.read_u16::<LittleEndian>()? as u32;
                 sample_rate = file.read_u32::<LittleEndian>()?;
                 let _byte_rate = file.read_u32::<LittleEndian>()?;
                 let _block_align = file.read_u16::<LittleEndian>()?;
                 bits_per_sample = file.read_u16::<LittleEndian>()?;
                 
                 // If chunk_size > 16, skip extra bytes (extensions)
                 let read_so_far = 16;
                 if chunk_size > read_so_far {
                     file.seek(SeekFrom::Current((chunk_size - read_so_far) as i64))?;
                 }
                 
                 // Initialize buffers
                 audio_data = vec![Vec::new(); channels as usize];

            } else if chunk_id == b"smpl" {
                 let mut chunk_bytes = vec![0u8; chunk_size as usize];
                 file.read_exact(&mut chunk_bytes)?;
                 let mut cur = std::io::Cursor::new(chunk_bytes);
                 
                 cur.seek(SeekFrom::Start(12))?;
                 let unity = cur.read_u32::<LittleEndian>()?;
                 if unity > 0 && unity < 128 {
                     root_note = Some(unity);
                 }
                 
                 let fraction = cur.read_u32::<LittleEndian>()?;
                 if fraction != 0 {
                    fine_tune = Some((fraction as f64 / 4294967296.0 * 100.0) as f32);
                 }
                 
                 cur.seek(SeekFrom::Start(28))?;
                 let num_loops = cur.read_u32::<LittleEndian>()?;
                 
                 if num_loops > 0 {
                     cur.seek(SeekFrom::Start(36 + 8))?; // +8 to reach 'Start'
                     let start = cur.read_u32::<LittleEndian>()?;
                     let end = cur.read_u32::<LittleEndian>()?;
                     loop_point = Some(LoopPoint { start, end });
                 }
                 
            } else if chunk_id == b"data" {
                 if audio_data.is_empty() {
                     audio_data = vec![Vec::new(); channels as usize];
                 }
                 
                 let bytes_per_sample = bits_per_sample / 8;
                 let num_samples_total = chunk_size / (channels as u32 * bytes_per_sample as u32);
                 
                 let max_samples = if let Some(duration) = max_duration {
                     (duration * sample_rate as f32) as u32
                 } else {
                     num_samples_total
                 };

                 let samples_to_read = num_samples_total.min(max_samples);
                 let bytes_to_read = (samples_to_read * channels as u32 * bytes_per_sample as u32) as usize;

                 // Reserve capacity
                 for ch in audio_data.iter_mut() {
                     ch.reserve(samples_to_read as usize);
                 }
                 
                 let mut raw_data = vec![0u8; bytes_to_read];
                 file.read_exact(&mut raw_data)?;

                 // Skip remaining bytes in the data chunk if partial load
                 if chunk_size as usize > bytes_to_read {
                     file.seek(SeekFrom::Current((chunk_size as usize - bytes_to_read) as i64))?;
                 }
                 
                 let mut offset = 0;
                 let mut ch_idx = 0;

                 while offset < raw_data.len() {
                     let mut sample_val = 0.0;
                     
                     if bits_per_sample == 16 {
                         if offset + 2 > raw_data.len() { break; }
                         let val = i16::from_le_bytes([raw_data[offset], raw_data[offset+1]]);
                         sample_val = val as f32 / 32768.0;
                         offset += 2;
                     } else if bits_per_sample == 24 {
                         if offset + 3 > raw_data.len() { break; }
                         let val = (raw_data[offset] as i32) 
                                 | ((raw_data[offset+1] as i32) << 8) 
                                 | ((raw_data[offset+2] as i8 as i32) << 16);
                         sample_val = val as f32 / 8388608.0;
                         offset += 3;
                     } else if bits_per_sample == 32 {
                         if offset + 4 > raw_data.len() { break; }
                         if audio_format == 3 { // Float
                             let val = f32::from_le_bytes([raw_data[offset], raw_data[offset+1], raw_data[offset+2], raw_data[offset+3]]);
                             sample_val = val;
                         } else { // Int32
                             let val = i32::from_le_bytes([raw_data[offset], raw_data[offset+1], raw_data[offset+2], raw_data[offset+3]]);
                             sample_val = val as f32 / 2147483648.0;
                         }
                         offset += 4;
                     } else if bits_per_sample == 8 {
                         if offset + 1 > raw_data.len() { break; }
                         let val = raw_data[offset];
                         sample_val = (val as f32 - 128.0) / 128.0;
                         offset += 1;
                     } else {
                         break;
                     }
                     
                     audio_data[ch_idx].push(sample_val);
                     ch_idx = (ch_idx + 1) % channels as usize;
                 }

            } else {
                file.seek(SeekFrom::Current(chunk_size as i64))?;
            }
            
            if chunk_size % 2 != 0 {
                file.seek(SeekFrom::Current(1))?;
            }
        }

        let sample = Arc::new(Sample {
             stop_id: stop_id.clone(),
             data: audio_data,
             sample_rate,
             loop_point,
             root_note,
             fine_tune,
             is_full: max_duration.is_none(),
        });

        self.buffers.write().unwrap().insert(key, sample);
        
        // Notify of progress via stdout for the main process to capture
        println!("{{\"type\": \"sample-loaded\", \"pipePath\": {:?}}}", path);
        
        Ok(())
    }

    pub fn unload_sample(&self, stop_id: &str, path: &str) {
        let key = format!("{}-{}", stop_id, path);
        self.buffers.write().unwrap().remove(&key);
    }

    pub fn get_sample(&self, stop_id: &str, pipe_path: &str) -> Option<Arc<Sample>> {
        let key = format!("{}-{}", stop_id, pipe_path);
        self.buffers.read().unwrap().get(&key).cloned()
    }

    pub fn get_memory_usage(&self) -> usize {
        let buffers = self.buffers.read().unwrap();
        let mut total = 0;
        for sample in buffers.values() {
            for channel in &sample.data {
                total += channel.len() * std::mem::size_of::<f32>();
            }
            // Add metadata etc approximately
            total += std::mem::size_of::<Sample>();
        }
        total
    }
}
