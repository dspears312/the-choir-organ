import fs from 'fs';

export function createPartialWav(fullPath: string, maxSamples: number = 48000): Buffer | null {
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

        // Fast crawl: find fmt and data chunks
        while (pos + 8 <= stats.size) {
            const header = Buffer.alloc(8);
            fs.readSync(fd, header, 0, 8, pos);
            const id = header.toString('ascii', 0, 4);
            const size = header.readInt32LE(4);

            chunks[id] = { offset: pos + 8, size };

            if (id === 'fmt ') {
                const buf = Buffer.alloc(size);
                fs.readSync(fd, buf, 0, size, pos + 8);
                chunks[id].buffer = buf;
            }

            // Stop crawling once we have both fmt and data
            if (chunks['fmt '] && chunks['data']) break;

            pos += 8 + size;
            if (size % 2 !== 0) pos++;
        }

        if (!chunks['fmt '] || !chunks['data']) return null;

        const fmtBuf = chunks['fmt '].buffer!;
        const channels = fmtBuf.readInt16LE(2);
        const sampleRate = fmtBuf.readInt32LE(4);
        const bitsPerSample = fmtBuf.readInt16LE(14);

        const dataChunk = chunks['data'];
        const bytesPerSample = bitsPerSample / 8;
        const requestedDataSize = Math.min(dataChunk.size, maxSamples * channels * bytesPerSample);

        // Create new Buffer: RIFF(12) + fmt(size+8) + data(reqSize+8)
        const headerSize = 12 + (fmtBuf.length + 8) + 8;
        const newBuffer = Buffer.alloc(headerSize + requestedDataSize);

        // Header: RIFF
        newBuffer.write('RIFF', 0);
        newBuffer.writeInt32LE(headerSize + requestedDataSize - 8, 4);
        newBuffer.write('WAVE', 8);

        // Chunk: fmt 
        newBuffer.write('fmt ', 12);
        newBuffer.writeInt32LE(fmtBuf.length, 16);
        fmtBuf.copy(newBuffer, 20);

        // Chunk: data
        const dataHeaderPos = 12 + (fmtBuf.length + 8);
        newBuffer.write('data', dataHeaderPos);
        newBuffer.writeInt32LE(requestedDataSize, dataHeaderPos + 4);

        // Read actual data
        fs.readSync(fd, newBuffer, headerSize, requestedDataSize, dataChunk.offset);

        return newBuffer;
    } catch (e) {
        console.error('Failed to create partial WAV:', e);
        return null;
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }
}
