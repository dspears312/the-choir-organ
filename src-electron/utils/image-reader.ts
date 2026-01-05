import fs from 'fs';

export function getImageDimensions(filePath: string): { width: number, height: number } | null {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(32);
        fs.readSync(fd, buffer, 0, 32, 0);
        fs.closeSync(fd);

        // BMP
        if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
            // Little Endian
            const width = buffer.readUInt32LE(18);
            const height = buffer.readUInt32LE(22);
            // Height can be negative (top-down), take abs
            return { width: width, height: Math.abs(height) };
        }

        // PNG
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            // IHDR usually starts at offset 12?
            // Signature: 8 bytes.
            // Chunk length: 4 bytes.
            // Chunk type (IHDR): 4 bytes.
            // Width: 4 bytes.
            // Height: 4 bytes.

            // Offset: 16 (Width), 20 (Height). Big Endian.
            const width = buffer.readUInt32BE(16);
            const height = buffer.readUInt32BE(20);
            return { width, height };
        }

        // JPG/JPEG (More complex, skip for now or use simplified search if needed)
        // Hauptwerk mostly uses BMP or PNG (cache).

        return null;

    } catch (e) {
        // console.error(`Failed to read image dimensions: ${filePath}`, e);
        return null;
    }
}
