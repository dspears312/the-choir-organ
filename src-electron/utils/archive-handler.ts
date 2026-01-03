import fs from 'fs';
import path from 'path';
import { app, BrowserWindow } from 'electron';
import crypto from 'crypto';
import { addToRecent } from './persistence';
import { fileURLToPath } from 'url';
import { WorkerFactory } from './worker-factory';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTRACTED_DIR_NAME = 'extracted_organs';

export function getExtractedOrgansDir(): string {
    const p = path.join(app.getPath('userData'), EXTRACTED_DIR_NAME);
    if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
    }
    return p;
}

/**
 * Handles extraction of RAR archives using a Worker thread.
 */
export async function handleRarExtraction(filePaths: string[], mainWindow: BrowserWindow): Promise<string | null> {
    const extractedDir = getExtractedOrgansDir();
    const primaries = filePaths.filter(p => p.toLowerCase().endsWith('.rar'));

    const wasmPath = findWasmPath();
    if (!wasmPath || !fs.existsSync(wasmPath)) {
        throw new Error(`Could not locate unrar.wasm at ${wasmPath}`);
    }
    const wasmBinaryRaw = fs.readFileSync(wasmPath);
    const wasmBinary = wasmBinaryRaw.buffer.slice(wasmBinaryRaw.byteOffset, wasmBinaryRaw.byteOffset + wasmBinaryRaw.byteLength);

    const allFoundOdfs: string[] = [];

    // Calculate total size for progress weighting
    let totalBatchSize = 0;
    for (const primary of primaries) {
        try {
            const stats = fs.statSync(primary);
            totalBatchSize += stats.size;
        } catch (e) {
            console.error(`[ArchiveHandler] Failed to stat ${primary}:`, e);
        }
    }

    // Signal start to UI if we have RARs to extract
    if (primaries.length > 0) {
        mainWindow.webContents.send('extraction-start');
    }

    let bytesExtractedBeforeCurrent = 0;

    for (const primary of primaries) {
        const archiveName = path.basename(primary, path.extname(primary));
        const hash = crypto.createHash('md5').update(primary).digest('hex').substring(0, 8);
        const targetDir = path.join(extractedDir, `${archiveName}_${hash}`);

        let currentArchiveSize = 0;
        try {
            currentArchiveSize = fs.statSync(primary).size;
        } catch (e) { }

        try {
            await extractInWorker(primary, targetDir, wasmBinary, (msg) => {
                if (msg.type === 'progress') {
                    // Estimate progress: unpSize is not directly comparable to compressed size, 
                    // but we can use the worker's own local progress and weight it.
                    if (msg.localProgress !== undefined) {
                        const weightedProgress = ((bytesExtractedBeforeCurrent + (msg.localProgress * currentArchiveSize / 100)) / totalBatchSize) * 100;
                        mainWindow.webContents.send('extraction-progress', {
                            progress: Math.min(99, Math.round(weightedProgress)),
                            file: msg.file
                        });
                    }
                }
            });

            bytesExtractedBeforeCurrent += currentArchiveSize;

            const odfs = scanForOdfs(targetDir);
            odfs.forEach(o => {
                addToRecent(o);
                allFoundOdfs.push(o);
            });
        } catch (err) {
            console.error(`[ArchiveHandler] node-unrar-js failed for ${primary}:`, err);
            bytesExtractedBeforeCurrent += currentArchiveSize; // Skip but still count towards progress
        }
    }

    return allFoundOdfs.length > 0 ? (allFoundOdfs[0] || null) : null;
}

async function extractInWorker(primary: string, targetDir: string, wasmBinary: ArrayBuffer, onMessage: (msg: any) => void): Promise<void> {
    await WorkerFactory.spawn('rar-worker', {
        workerData: { primary, targetDir, wasmBinary },
        onMessage
    });
}

function findWasmPath(): string {
    const devPath = path.resolve('node_modules/node-unrar-js/dist/js/unrar.wasm');
    if (fs.existsSync(devPath)) return devPath;

    const prodPath = path.join(app.getAppPath(), 'node_modules/node-unrar-js/dist/js/unrar.wasm');
    if (fs.existsSync(prodPath)) return prodPath;

    const altPath = path.join(app.getAppPath(), '..', 'node_modules/node-unrar-js/dist/js/unrar.wasm');
    if (fs.existsSync(altPath)) return altPath;

    return devPath;
}

function scanForOdfs(dir: string): string[] {
    const results: string[] = [];
    function walk(current: string) {
        if (!fs.existsSync(current)) return;
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const lower = entry.name.toLowerCase();
                if (lower.endsWith('.organ') || lower.endsWith('.organ_hauptwerk_xml')) {
                    results.push(fullPath);
                }
            }
        }
    }
    walk(dir);
    return results;
}
