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

pub enum SampleSource {
    InMemory(Vec<Vec<f32>>), // De-interleaved f32
    Streaming {
        attack: Vec<Vec<f32>>, // First ~100ms for instant start
        mmap: Arc<memmap2::Mmap>,
        data_start: usize,
        channels: u16,

        bits_per_sample: u16,
        is_float: bool,
        total_samples: usize,
    },
}

pub struct Sample {
    pub stop_id: String,
    pub source: SampleSource,
    pub sample_rate: u32,
    pub loop_point: Option<LoopPoint>,
    pub root_note: Option<u32>,
    pub fine_tune: Option<f32>,
    pub is_full: bool,
}

impl Sample {
    pub fn get_len(&self) -> usize {
        match &self.source {
            SampleSource::InMemory(data) => if data.is_empty() { 0 } else { data[0].len() },
            SampleSource::Streaming { total_samples, .. } => *total_samples,
        }
    }

    pub fn get_sample(&self, channel: usize, idx: usize) -> f32 {
        match &self.source {
            SampleSource::InMemory(data) => {
                if channel < data.len() && idx < data[channel].len() {
                    data[channel][idx]
                } else {
                    0.0
                }
            }
            SampleSource::Streaming { 
                attack, mmap, data_start, channels, bits_per_sample, is_float, total_samples, .. 
            } => {
                // Try attack buffer first
                if channel < attack.len() && idx < attack[channel].len() {
                    return attack[channel][idx];
                }

                if idx >= *total_samples { return 0.0; }

                // Pull from mmap
                let ch_count = *channels as usize;
                let bytes_per_sample = (*bits_per_sample / 8) as usize;
                let frame_size = ch_count * bytes_per_sample;
                let offset = *data_start + (idx * frame_size) + (channel * bytes_per_sample);

                if offset + bytes_per_sample > mmap.len() { return 0.0; }

                let slice = &mmap[offset..offset + bytes_per_sample];
                
                if *is_float {
                    if *bits_per_sample == 32 {
                        f32::from_le_bytes(slice.try_into().unwrap_or([0; 4]))
                    } else {
                        0.0
                    }
                } else {
                    match *bits_per_sample {
                        16 => {
                            let val = i16::from_le_bytes(slice.try_into().unwrap_or([0; 2]));
                            val as f32 / 32768.0
                        }
                        24 => {
                            let val = (slice[0] as i32) 
                                    | ((slice[1] as i32) << 8) 
                                    | ((slice[2] as i8 as i32) << 16);
                            val as f32 / 8388608.0
                        }
                        8 => {
                            (slice[0] as f32 - 128.0) / 128.0
                        }
                        _ => 0.0
                    }
                }
            }
        }
    }
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
        
        {
            let buffers = self.buffers.read().unwrap();
            if let Some(existing) = buffers.get(&key) {
                if existing.is_full {
                    return Ok(());
                }
                if max_duration.is_some() && !existing.is_full {
                    return Ok(());
                }
            }
        }

        let mut file = File::open(&path)?;
        let mut buffer = [0u8; 12];
        file.read_exact(&mut buffer)?;

        if &buffer[0..4] != b"RIFF" || &buffer[8..12] != b"WAVE" {
             return Err(anyhow::anyhow!("Not a valid RIFF/WAVE file"));
        }

        let mut sample_rate = 44100;
        let mut channels = 1;
        let mut bits_per_sample = 16;
        let mut audio_format = 1; // 1 = PCM, 3 = Float

        let mut loop_point = None;
        let mut root_note = None;
        let mut fine_tune = None;
        
        let mut data_start_offset = 0;
        let mut data_chunk_size = 0;

        loop {
            let mut chunk_header = [0u8; 8];
            if file.read_exact(&mut chunk_header).is_err() { break; }

            let chunk_id = &chunk_header[0..4];
            let chunk_size = (&chunk_header[4..8]).read_u32::<LittleEndian>()?;

            if chunk_id == b"fmt " {
                 audio_format = file.read_u16::<LittleEndian>()?;
                 let ch = file.read_u16::<LittleEndian>()?;
                 channels = ch as u32;
                 sample_rate = file.read_u32::<LittleEndian>()?;
                 file.seek(SeekFrom::Current(6))?; // skip byte_rate, block_align
                 bits_per_sample = file.read_u16::<LittleEndian>()?;
                 
                 // Handle WAVE_FORMAT_EXTENSIBLE
                 if audio_format == 0xFFFE && chunk_size >= 40 {
                     file.seek(SeekFrom::Current(8))?; // Skip cbSize (2) and ValidBitsPerSample (2) and dwChannelMask (4)
                     audio_format = file.read_u16::<LittleEndian>()?; // SubFormat's first 2 bytes (GUID)
                 }

                 let read_so_far = 16;
                 if chunk_size > (read_so_far as u32) {
                     let skip = chunk_size - read_so_far as u32;
                     file.seek(SeekFrom::Current(skip as i64))?;
                 }

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
                    // Intepret as signed i32 to support negative fine-tuning (common in some editors)
                    // 0xFFFFFFFF becomes -1 (approx 0 cents) instead of +100 cents
                    fine_tune = Some((fraction as i32 as f64 / 4294967296.0 * 100.0) as f32);
                 }
                 
                 cur.seek(SeekFrom::Start(28))?;
                 let num_loops = cur.read_u32::<LittleEndian>()?;
                 
                 if num_loops > 0 {
                     cur.seek(SeekFrom::Start(36 + 8))?;
                     let start = cur.read_u32::<LittleEndian>()?;
                     let end = cur.read_u32::<LittleEndian>()?;
                     loop_point = Some(LoopPoint { start, end });
                 }
                 
            } else if chunk_id == b"data" {
                 data_start_offset = file.stream_position()? as usize;
                 data_chunk_size = chunk_size;
                 file.seek(SeekFrom::Current(chunk_size as i64))?;
            } else {
                file.seek(SeekFrom::Current(chunk_size as i64))?;
            }
            
            if chunk_size % 2 != 0 {
                file.seek(SeekFrom::Current(1))?;
            }
        }

        // Now we have the metadata, decide on loading strategy
        let bytes_per_sample = (bits_per_sample / 8) as u32;
        let total_samples = data_chunk_size / (channels * bytes_per_sample);
        
        let mut audio_data: Vec<Vec<f32>> = vec![Vec::new(); channels as usize];
        
        // Always load at least the attack (e.g. 100ms) or everything if max_duration/mmap is not used
        let attack_duration_sec = 0.1;
        let attack_samples_limit = (attack_duration_sec * sample_rate as f32) as u32;
        
        let samples_to_buffer = if let Some(dur) = max_duration {
            (dur * sample_rate as f32) as u32
        } else {
             // For streaming, we buffer the attack. For small files, we could just buffer everything,
             // but let's stick to the strategy: buffer attack, mmap rest.
             attack_samples_limit.min(total_samples)
        };

        // Read buffered part
        file.seek(SeekFrom::Start(data_start_offset as u64))?;
        let bytes_to_read = (samples_to_buffer * channels * bytes_per_sample) as usize;
        let mut raw_data = vec![0u8; bytes_to_read];
        file.read_exact(&mut raw_data)?;

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
                if audio_format == 3 {
                    sample_val = f32::from_le_bytes([raw_data[offset], raw_data[offset+1], raw_data[offset+2], raw_data[offset+3]]);
                } else {
                    let val = i32::from_le_bytes([raw_data[offset], raw_data[offset+1], raw_data[offset+2], raw_data[offset+3]]);
                    sample_val = val as f32 / 2147483648.0;
                }
                offset += 4;
            } else if bits_per_sample == 8 {
                sample_val = (raw_data[offset] as f32 - 128.0) / 128.0;
                offset += 1;
            }
            audio_data[ch_idx].push(sample_val);
            ch_idx = (ch_idx + 1) % channels as usize;
        }

        let source = if max_duration.is_some() {
            SampleSource::InMemory(audio_data)
        } else {
            // Memory map the file for the rest
            let mmap = unsafe { memmap2::Mmap::map(&File::open(&path)?)? };
            SampleSource::Streaming {
                attack: audio_data,
                mmap: Arc::new(mmap),
                data_start: data_start_offset,
                channels: channels as u16,

                bits_per_sample,
                is_float: audio_format == 3,
                total_samples: total_samples as usize,
            }
        };

        let sample = Arc::new(Sample {
             stop_id: stop_id.clone(),
             source,
             sample_rate,
             loop_point,
             root_note,
             fine_tune,
             is_full: max_duration.is_none(),
        });

        self.buffers.write().unwrap().insert(key, sample);
        log::info!("Loaded Sample: {} | Rate: {} | Chan: {} | Bits: {} | Format: {} | Total: {} | Path: {}", 
            stop_id, sample_rate, channels, bits_per_sample, audio_format, total_samples, path);
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
            match &sample.source {
                SampleSource::InMemory(data) => {
                    for channel in data {
                        total += channel.len() * std::mem::size_of::<f32>();
                    }
                }
                SampleSource::Streaming { attack, .. } => {
                    for channel in attack {
                        total += channel.len() * std::mem::size_of::<f32>();
                    }
                }
            }
            total += std::mem::size_of::<Sample>();
        }
        total
    }

}
