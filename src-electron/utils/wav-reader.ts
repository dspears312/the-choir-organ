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

export function readWav(filePath: string, maxSamples?: number, metadataOnly: boolean = false): WavInfo {
    let fd: number | null = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const stats = fs.statSync(filePath);

        // Basic RIFF Validation
        const riffHeader = Buffer.alloc(12);
        fs.readSync(fd, riffHeader, 0, 12, 0);
        if (riffHeader.toString('ascii', 0, 4) !== 'RIFF' || riffHeader.toString('ascii', 8, 12) !== 'WAVE') {
            throw new Error('Not a valid WAVE file');
        }

        const chunks: Record<string, { offset: number, size: number, buffer?: Buffer }> = {};
        let pos = 12;

        // Fast crawl: only read 8-byte chunk headers
        while (pos + 8 <= stats.size) {
            const header = Buffer.alloc(8);
            fs.readSync(fd, header, 0, 8, pos);
            const id = header.toString('ascii', 0, 4);
            const size = header.readInt32LE(4);

            chunks[id] = { offset: pos + 8, size };

            // For small metadata chunks, read them into memory now
            if (id === 'fmt ' || id === 'smpl' || id === 'cue ') {
                const buf = Buffer.alloc(size);
                fs.readSync(fd, buf, 0, size, pos + 8);
                chunks[id].buffer = buf;
            }

            pos += 8 + size;
            if (size % 2 !== 0) pos++; // Chunks are word-aligned
        }

        if (!chunks['fmt ']) throw new Error('Missing fmt chunk');

        // Extract format info
        const fmtBuf = chunks['fmt '].buffer!;
        const audioFormat = fmtBuf.readInt16LE(0);
        const channels = fmtBuf.readInt16LE(2);
        const sampleRate = fmtBuf.readInt32LE(4);
        const bitsPerSample = fmtBuf.readInt16LE(14);
        const bitDepth = bitsPerSample.toString();

        // Calculate duration based on data chunk size
        const dataChunk = chunks['data'];
        let durationSamples = 0;
        if (dataChunk) {
            const bytesPerSample = bitsPerSample / 8;
            durationSamples = dataChunk.size / (channels * bytesPerSample);
        }

        // Use WaveFile only for high-level chunk parsing (loops/cues) if needed
        // but we can also parse them manually for speed.
        const smplBuf = chunks['smpl']?.buffer;
        const loops: WavLoop[] = [];
        let unityNote: number | undefined;
        let pitchFraction: number | undefined;

        if (smplBuf) {
            unityNote = smplBuf.readInt32LE(12); // dwMIDIUnityNote
            pitchFraction = smplBuf.readInt32LE(16); // dwMIDIPitchFraction
            const numLoops = smplBuf.readInt32LE(28); // cSampleLoops
            for (let i = 0; i < numLoops; i++) {
                const loopStart = 36 + (i * 24) + 8; // Offset to dwStart (36 = header size, 24 = loop struct size)
                const start = smplBuf.readInt32LE(loopStart);
                const end = smplBuf.readInt32LE(loopStart + 4);
                loops.push({ start, end });
            }
        }

        const cues: WavCue[] = [];
        const cueBuf = chunks['cue ']?.buffer;
        if (cueBuf) {
            const numPoints = cueBuf.readInt32LE(0);
            for (let i = 0; i < numPoints; i++) {
                const ptOffset = 4 + (i * 24);
                const id = cueBuf.readInt32LE(ptOffset);
                const position = cueBuf.readInt32LE(ptOffset + 20); // dwSampleOffset
                cues.push({ id, position });
            }
        }

        let normalizedData: Float32Array[] = [];
        if (!metadataOnly && dataChunk) {
            // If data is needed, we finally use a full read
            // For now, to keep it simple and compatible, we'll use fs.readFileSync of the whole file 
            // and pass to WaveFile for sample extraction, but we could also stream samples.
            const fullBuffer = fs.readFileSync(filePath);
            const wav = new WaveFile(fullBuffer);
            const samples = wav.getSamples(false);
            const rawData = Array.isArray(samples) ? samples : [samples];

            normalizedData = rawData.map(channel => {
                const isFloat = audioFormat === 3;
                if (isFloat) return channel instanceof Float32Array ? channel : new Float32Array(channel);

                let divisor = 32768;
                if (bitsPerSample === 24) divisor = 8388608;
                else if (bitsPerSample === 32) divisor = 2147483648;
                else if (bitsPerSample === 8) divisor = 128;

                const finalLength = maxSamples ? Math.min(channel.length, maxSamples) : channel.length;
                const out = new Float32Array(finalLength);
                for (let i = 0; i < finalLength; i++) {
                    out[i] = channel[i] / divisor;
                }
                return out;
            });
            durationSamples = normalizedData[0]?.length || 0;
        }

        return {
            sampleRate,
            bitDepth,
            channels,
            loops,
            cues,
            unityNote,
            pitchFraction,
            durationSamples,
            data: normalizedData
        };
    } catch (e) {
        console.error(`Error reading WAV ${filePath}:`, e);
        return {
            sampleRate: 44100,
            bitDepth: '16',
            channels: 1,
            loops: [],
            cues: [],
            durationSamples: 0,
            data: []
        };
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) { /* ignore */ }
        }
    }
}
