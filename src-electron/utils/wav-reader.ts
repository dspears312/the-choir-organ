import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('wavefile');
import fs from 'fs';

// Resilient constructor extraction for WaveFile in Electron/CJS environment
const WaveFile = pkg.WaveFile || pkg;

export interface WavLoop {
    start: number;
    end: number;
}

export interface WavCue {
    id: number;
    position: number;
    label?: string;
}

export interface WavInfo {
    sampleRate: number;
    bitDepth: string;
    channels: number;
    loops: WavLoop[];
    cues: WavCue[];
    unityNote?: number | undefined;
    pitchFraction?: number | undefined;
    durationSamples: number;
    data: Float32Array[]; // Mono or Stereo, normalized to -1.0 to 1.0
}

export function readWav(filePath: string): WavInfo {
    const buffer = fs.readFileSync(filePath);

    if (typeof WaveFile !== 'function') {
        console.error('WaveFile constructor is invalid in readWav!', typeof WaveFile);
    }

    let wav: any;
    try {
        wav = new WaveFile(buffer);
    } catch (e) {
        console.error(`Failed to instantiate WaveFile for ${filePath}.`, e);
        return {
            sampleRate: 44100,
            bitDepth: '16',
            channels: 1,
            loops: [],
            cues: [],
            durationSamples: 0,
            data: []
        };
    }

    // Debug logging for sample rate detection
    const fmt = (wav as any).fmt;
    const directRate = (wav as any).sampleRate;
    // console.log(`[wav-reader] Debug: fmt.sampleRate=${fmt?.sampleRate}, direct=${directRate}, path=${filePath}`);

    const sampleRate = fmt?.sampleRate || directRate || 44100;
    const bitDepth = (fmt?.bitsPerSample || (wav as any).bitDepth || '16').toString();
    const channels = fmt?.numChannels || 1;

    let samples: any;
    try {
        // Use getSamples(false) to ensure de-interleaved data (planar).
        // This returns Float64Array[] (for stereo) or Float64Array (for mono).
        // Note: The values in these arrays are adhering to the file's format (int or float).
        samples = wav.getSamples(false);
    } catch (e) {
        console.error(`Fatal: Could not read samples from ${filePath}`, e);
        return {
            sampleRate,
            bitDepth,
            channels: 1,
            loops: [],
            cues: [],
            durationSamples: 0,
            data: []
        };
    }

    const rawData = Array.isArray(samples) ? samples : [samples];

    const normalizedData = rawData.map(channel => {
        // Check for Float format first (format code 3 or bitDepth ending in 'f')
        const fmt = (wav as any).fmt;
        const audioFormat = fmt ? fmt.audioFormat : 1; // Default to 1 (PCM) if unknown
        const isFloat = audioFormat === 3 || bitDepth.toString().toLowerCase().endsWith('f');

        if (isFloat) {
            // Already float, just ensure it's Float32Array
            return channel instanceof Float32Array ? channel : new Float32Array(channel);
        }

        // It is PCM (or unknown). We must normalize by dividing by the range.
        let divisor = 32768; // Default 16-bit
        const headerBits = parseInt(bitDepth.replace(/\D/g, ''), 10) || 16;

        if (headerBits === 24) divisor = 8388608;
        else if (headerBits === 32) divisor = 2147483648;
        else if (headerBits === 8) divisor = 128; // 8-bit is usually unsigned 0-255, wavefile might unpack it?
        // Note: wavefile getSamples(false) returns values in their native range. 
        // 8-bit might be 0-255 or -128-127 depending on implementation, but standard WAV 8-bit is unsigned.
        // If wavefile normalizes 8-bit to signed, we'd need to check. 
        // Assuming wavefile handles 8-bit -> signed conversion? 
        // Actually wavefile documentation says getSamples returns numbers.
        // Let's stick to standard signed PCM divisors for 16/24/32.

        // Safety check: specific override if values exceed the declared range (e.g. Header says 16 but values act like 32-bit)
        // We only scan if necessary or to catch mismatched headers.

        // Let's scan briefly just to handle cases where header is WRONG (says 16, is 32)
        // because "detuned noise" suggests we might be getting it wrong.
        let maxVal = 0;
        const scanLimit = Math.min(channel.length, 1000);
        for (let i = 0; i < scanLimit; i++) {
            const v = Math.abs(channel[i]);
            if (v > maxVal) maxVal = v;
        }

        // Determine divisor behavior
        if (maxVal > 2147483648) divisor = 2147483648; // Logic barrier
        else if (maxVal > 8388607 && divisor < 2147483648) divisor = 2147483648;
        else if (maxVal > 32768 && divisor < 8388608) divisor = 8388608;

        // If maxVal is tiny (e.g. 1), we used to return raw float. 
        // NOW, we stick to the divisor determined by bitDepth (e.g. 32768).
        // This ensures quiet 16-bit files remain quiet, instead of becoming full-scale noise.

        // Apply normalization
        const out = new Float32Array(channel.length);
        for (let i = 0; i < channel.length; i++) {
            out[i] = channel[i] / divisor;
        }

        // Log once per file if we had to scale
        if (channel === rawData[0]) {
            // console.log(`[wav-reader] Auto-normalized ${filePath} (Peak: ${maxVal.toFixed(0)} -> Divisor: ${divisor})`);
        }

        return out;
    });

    // samples is now either:
    // 1. Result of getSamples(true) -> Float64Array[] usually
    // 2. Result of manual normalization -> Float32Array[]

    // Data is already normalized and in `normalizedData` from above code block
    // NO-OP or just validation


    const loops: WavLoop[] = [];
    let unityNote: number | undefined;
    let pitchFraction: number | undefined;

    const smpl = (wav as any).smpl;
    if (smpl) {
        unityNote = smpl.dwMIDIUnityNote;
        pitchFraction = smpl.dwMIDIPitchFraction;
        if (smpl.loops) {
            smpl.loops.forEach((loop: any) => {
                loops.push({
                    start: loop.dwStart || 0,
                    end: loop.dwEnd || 0
                });
            });
        }
    }

    const cues: WavCue[] = [];
    const cueChunk = (wav as any).cue;
    if (cueChunk && cueChunk.points) {
        cueChunk.points.forEach((pt: any) => {
            cues.push({
                id: pt.dwName,
                position: pt.dwSampleOffset
            });
        });
    }

    return {
        sampleRate,
        bitDepth,
        channels,
        loops,
        cues,
        unityNote,
        pitchFraction,
        durationSamples: normalizedData[0]?.length || 0,
        data: normalizedData
    };
}
