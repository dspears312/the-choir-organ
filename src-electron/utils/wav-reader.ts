import fs from 'fs';

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

export interface WavReaderOptions {
    maxSamples?: number;
    maxDuration?: number; // seconds
    cropToLoop?: boolean;
    metadataOnly?: boolean;
}

export function readWav(filePath: string, options: WavReaderOptions = {}): WavInfo {
    let fd: number | null = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const stats = fs.statSync(filePath);

        // ... (Header parsing logic remains same until data read) ...
        const riffHeader = Buffer.alloc(12);
        fs.readSync(fd, riffHeader, 0, 12, 0);
        if (riffHeader.toString('ascii', 0, 4) !== 'RIFF' || riffHeader.toString('ascii', 8, 12) !== 'WAVE') {
            throw new Error('Not a valid WAVE file');
        }

        const chunks: Record<string, { offset: number, size: number, buffer?: Buffer }> = {};
        let pos = 12;

        while (pos + 8 <= stats.size) {
            const header = Buffer.alloc(8);
            fs.readSync(fd, header, 0, 8, pos);
            const id = header.toString('ascii', 0, 4);
            const size = header.readInt32LE(4);

            chunks[id] = { offset: pos + 8, size };

            if (id === 'fmt ' || id === 'smpl' || id === 'cue ') {
                const buf = Buffer.alloc(size);
                fs.readSync(fd, buf, 0, size, pos + 8);
                chunks[id].buffer = buf;
            }

            pos += 8 + size;
            if (size % 2 !== 0) pos++;
        }

        if (!chunks['fmt ']) throw new Error('Missing fmt chunk');

        const fmtBuf = chunks['fmt '].buffer!;
        const audioFormat = fmtBuf.readInt16LE(0);
        const channels = fmtBuf.readInt16LE(2);
        const sampleRate = fmtBuf.readInt32LE(4);
        const bitsPerSample = fmtBuf.readInt16LE(14);
        const bitDepth = bitsPerSample.toString();

        // Parse loops early to determine cropping
        const smplBuf = chunks['smpl']?.buffer;
        const loops: WavLoop[] = [];
        let unityNote: number | undefined;
        let pitchFraction: number | undefined;

        if (smplBuf) {
            unityNote = smplBuf.readInt32LE(12);
            pitchFraction = smplBuf.readInt32LE(16);
            const numLoops = smplBuf.readInt32LE(28);
            for (let i = 0; i < numLoops; i++) {
                const loopStart = 36 + (i * 24) + 8;
                const start = smplBuf.readInt32LE(loopStart);
                const end = smplBuf.readInt32LE(loopStart + 4);
                loops.push({ start, end });
            }
        }

        // Parse Cues
        const cues: WavCue[] = [];
        const cueBuf = chunks['cue ']?.buffer;
        if (cueBuf) {
            const numPoints = cueBuf.readInt32LE(0);
            for (let i = 0; i < numPoints; i++) {
                const ptOffset = 4 + (i * 24);
                const id = cueBuf.readInt32LE(ptOffset);
                const position = cueBuf.readInt32LE(ptOffset + 20);
                cues.push({ id, position });
            }
        }

        // Determine max samples to read
        let limitSamples = Infinity;

        if (options.cropToLoop && loops.length > 0) {
            // Find the furthest loop end point
            const maxLoopEnd = Math.max(...loops.map(l => l.end));
            limitSamples = maxLoopEnd + 1024; // Add a small buffer for crossfading if needed, or just strict end
        }

        if (options.maxDuration) {
            const durationLim = Math.floor(options.maxDuration * sampleRate);
            limitSamples = Math.min(limitSamples, durationLim);
        }

        if (options.maxSamples) {
            limitSamples = Math.min(limitSamples, options.maxSamples);
        }

        let normalizedData: Float32Array[] = [];
        let durationSamples = 0;

        if (!options.metadataOnly && chunks['data']) {
            // Read data logic
            // To support efficient partial reading without loading whole file, we should use fs.readSync with limit

            const bytesPerSample = bitsPerSample / 8;
            const dataOffset = chunks['data'].offset;
            const totalSamplesInFile = chunks['data'].size / (channels * bytesPerSample);

            const samplesToRead = Math.min(totalSamplesInFile, limitSamples);
            const bytesToRead = samplesToRead * channels * bytesPerSample;

            // Read specific buffer
            const rawBuffer = Buffer.alloc(bytesToRead);
            fs.readSync(fd, rawBuffer, 0, bytesToRead, dataOffset);

            // Use WaveFile to decode this specific chunk? 
            // WaveFile expects a full WAV. Constructing one is expensive.
            // Better to manually decode PCM since we have the format info.

            // Manual Decoding
            normalizedData = [];
            for (let ch = 0; ch < channels; ch++) normalizedData.push(new Float32Array(samplesToRead));

            let offset = 0;
            const divisor = bitsPerSample === 24 ? 8388608 : (bitsPerSample === 32 ? 2147483648 : (bitsPerSample === 8 ? 128 : 32768));

            // Helper to read sample
            const readSample = (offset: number) => {
                if (bitsPerSample === 16) return rawBuffer.readInt16LE(offset);
                if (bitsPerSample === 24) return rawBuffer.readIntLE(offset, 3);
                if (bitsPerSample === 32) return audioFormat === 3 ? rawBuffer.readFloatLE(offset) : rawBuffer.readInt32LE(offset);
                if (bitsPerSample === 8) return rawBuffer.readUInt8(offset) - 128;
                return 0;
            };

            for (let i = 0; i < samplesToRead; i++) {
                for (let ch = 0; ch < channels; ch++) {
                    const sample = readSample(offset);
                    // Normalize
                    let val = sample;
                    if (audioFormat !== 3) { // If not float
                        val = sample / divisor;
                    }
                    if (normalizedData[ch]) {
                        normalizedData[ch][i] = val;
                    }
                    offset += bytesPerSample;
                }
            }

            // Update Duration
            durationSamples = samplesToRead;
        } else if (chunks['data']) {
            const bytesPerSample = bitsPerSample / 8;
            durationSamples = chunks['data'].size / (channels * bytesPerSample);
        } else {
            durationSamples = 0;
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
