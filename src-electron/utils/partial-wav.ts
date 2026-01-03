import fs from 'fs';

export interface PartialWavOptions {
    maxSamples?: number;
    maxDuration?: number;
    cropToLoop?: boolean;
}

export function createPartialWav(fullPath: string, optionsOrMaxSamples: PartialWavOptions | number = 48000): Buffer | null {
    const options: PartialWavOptions = typeof optionsOrMaxSamples === 'number'
        ? { maxSamples: optionsOrMaxSamples }
        : optionsOrMaxSamples;

    let fd: number | null = null;
    try {
        fd = fs.openSync(fullPath, 'r');
        const stats = fs.statSync(fullPath);

        // Basic RIFF Validation
        const riffHeader = Buffer.alloc(12);
        fs.readSync(fd, riffHeader, 0, 12, 0);
        if (riffHeader.toString('ascii', 0, 4) !== 'RIFF' || riffHeader.toString('ascii', 8, 12) !== 'WAVE') {
            return null;
        }

        const chunks: Record<string, { offset: number, size: number, buffer?: Buffer }> = {};
        let pos = 12;

        // Fast crawl: find fmt, data, and smpl chunks
        while (pos + 8 <= stats.size) {
            const header = Buffer.alloc(8);
            fs.readSync(fd, header, 0, 8, pos);
            const id = header.toString('ascii', 0, 4);
            const size = header.readInt32LE(4);

            chunks[id] = { offset: pos + 8, size };

            if (id === 'fmt ' || id === 'smpl') {
                const buf = Buffer.alloc(size);
                fs.readSync(fd, buf, 0, size, pos + 8);
                chunks[id].buffer = buf;
            }

            pos += 8 + size;
            if (size % 2 !== 0) pos++;
        }

        if (!chunks['fmt '] || !chunks['data']) return null;

        const fmtBuf = chunks['fmt '].buffer!;
        const channels = fmtBuf.readInt16LE(2);
        const sampleRate = fmtBuf.readInt32LE(4);
        const bitsPerSample = fmtBuf.readInt16LE(14);
        const bytesPerSample = bitsPerSample / 8;

        // Determine Sample Limit
        let sampleLimit = Infinity;

        if (options.maxSamples) {
            sampleLimit = Math.min(sampleLimit, options.maxSamples);
        }

        if (options.maxDuration) {
            sampleLimit = Math.min(sampleLimit, Math.floor(options.maxDuration * sampleRate));
        }

        if (options.cropToLoop && chunks['smpl'] && chunks['smpl'].buffer) {
            const smplBuf = chunks['smpl'].buffer;
            // Parse loops
            const numLoops = smplBuf.readInt32LE(28); // cSampleLoops
            let maxLoopEnd = 0;
            for (let i = 0; i < numLoops; i++) {
                const loopStartOffset = 36 + (i * 24) + 8;
                const end = smplBuf.readInt32LE(loopStartOffset + 4);
                if (end > maxLoopEnd) maxLoopEnd = end;
            }
            if (numLoops > 0) {
                sampleLimit = Math.min(sampleLimit, maxLoopEnd + 1024); // + safety buffer
            }
        }

        const dataChunk = chunks['data'];
        const totalSamples = dataChunk.size / (channels * bytesPerSample);
        const finalSamples = Math.min(totalSamples, sampleLimit);
        const requestedDataSize = finalSamples * channels * bytesPerSample;

        // If we are reading the whole file anyway, just return the file?
        // But headers might be weird. Safest to reconstruct or standard slice.
        // Actually for huge files, fs.readFileSync is bad.
        // But requestedDataSize should be small if cropped.

        // Construct New WAV

        // Calculate Header Size: RIFF(12) + fmt(size+8) + smpl?(size+8) + data(reqSize+8)
        // We should include smpl chunk if it existed, so loops are preserved!
        let headerSize = 12 + (fmtBuf.length + 8) + 8; // RIFF + fmt + data header
        if (chunks['smpl'] && chunks['smpl'].buffer) {
            headerSize += chunks['smpl'].size + 8;
        }

        const newBuffer = Buffer.alloc(headerSize + requestedDataSize);
        let writePos = 0;

        // RIFF
        newBuffer.write('RIFF', 0);
        newBuffer.writeInt32LE(headerSize + requestedDataSize - 8, 4);
        newBuffer.write('WAVE', 8);
        writePos = 12;

        // fmt 
        newBuffer.write('fmt ', writePos);
        newBuffer.writeInt32LE(fmtBuf.length, writePos + 4);
        fmtBuf.copy(newBuffer, writePos + 8);
        writePos += 8 + fmtBuf.length;

        // smpl (if exists)
        if (chunks['smpl'] && chunks['smpl'].buffer) {
            const smpl = chunks['smpl'];
            newBuffer.write('smpl', writePos);
            newBuffer.writeInt32LE(smpl.size, writePos + 4);
            smpl.buffer!.copy(newBuffer, writePos + 8);
            writePos += 8 + smpl.size;
        }

        // data
        newBuffer.write('data', writePos);
        newBuffer.writeInt32LE(requestedDataSize, writePos + 4);
        // writePos += 8; // Not needed, we read directly to offset

        // Read Data
        fs.readSync(fd, newBuffer, writePos + 8, requestedDataSize, dataChunk.offset);

        return newBuffer;
    } catch (e) {
        console.error('Failed to create partial WAV:', e);
        return null;
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }
}
