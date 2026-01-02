import { parentPort, workerData } from 'worker_threads';
import { createExtractorFromFile } from 'node-unrar-js';
import fs from 'fs';

/**
 * Worker thread for RAR extraction.
 * Communicates progress back to the main thread.
 * Plain JS version to avoid ts-node issues in dev.
 */

async function main() {
    const { primary, targetDir, wasmBinary } = workerData;

    try {
        console.log(`[RarWorker] Starting extraction: ${primary}`);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const extractor = await createExtractorFromFile({
            filepath: primary,
            targetPath: targetDir,
            wasmBinary: wasmBinary
        });

        // Get total uncompressed size for progress
        const list = extractor.getFileList();
        let totalUnpSize = 0;
        for (const header of list.fileHeaders) {
            totalUnpSize += header.unpSize;
        }

        parentPort?.postMessage({
            type: 'start',
            totalUnpSize
        });

        const result = extractor.extract();
        let extractedBytes = 0;
        for (const file of result.files) {
            if (!file.fileHeader.flags.directory) {
                extractedBytes += file.fileHeader.unpSize;
                parentPort?.postMessage({
                    type: 'progress',
                    unpSize: file.fileHeader.unpSize,
                    localProgress: Math.round((extractedBytes / totalUnpSize) * 100),
                    file: file.fileHeader.name
                });
            }
        }

        parentPort?.postMessage({
            type: 'done',
            targetDir
        });
    } catch (err) {
        console.error(`[RarWorker] Failed:`, err);
        parentPort?.postMessage({
            type: 'error',
            error: err.message || String(err)
        });
    }
}

main();
