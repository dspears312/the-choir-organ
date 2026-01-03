import { Worker, WorkerOptions } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkerMessage {
    type: string;
    [key: string]: any;
}

export interface WorkerFactoryOptions {
    workerData?: any;
    onMessage?: (msg: WorkerMessage) => void;
    onProgress?: (progress: number, data?: any) => void;
    onError?: (err: Error) => void;
    onExit?: (code: number) => void;
}

/**
 * Utility for creating and managing Worker threads in an Electron environment.
 * Handles dev/prod path resolution and TypeScript loading.
 */
export class WorkerFactory {
    /**
     * Spawns a worker and returns a promise that resolves when the worker completes ('success' or 'done' message).
     */
    static spawn(
        workerName: string,
        options: WorkerFactoryOptions = {}
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const workerPath = this.resolveWorkerPath(workerName);

            const workerOptions: WorkerOptions = {
                workerData: options.workerData,
                env: {
                    TS_NODE_TRANSPILE_ONLY: 'true',
                    ...process.env
                }
            };

            // Add TypeScript loader if in dev/ts mode
            if (workerPath.endsWith('.ts')) {
                workerOptions.execArgv = [
                    '--loader', 'ts-node/esm',
                    '--experimental-specifier-resolution=node',
                    '--no-warnings'
                ];
            }

            console.log(`[WorkerFactory] Spawning worker: ${workerPath}`);
            const worker = new Worker(workerPath, workerOptions);

            worker.on('message', (msg: WorkerMessage) => {
                if (options.onMessage) options.onMessage(msg);

                if (msg.type === 'progress') {
                    if (options.onProgress) {
                        options.onProgress(msg.progress ?? msg.localProgress, msg);
                    }
                } else if (msg.type === 'success' || msg.type === 'done') {
                    resolve(msg.data ?? msg.filePath ?? msg.targetDir);
                } else if (msg.type === 'error') {
                    const err = new Error(msg.error || 'Unknown worker error');
                    if (options.onError) options.onError(err);
                    reject(err);
                }
            });

            worker.on('error', (err) => {
                console.error(`[WorkerFactory] Thread Error (${workerName}):`, err);
                if (options.onError) options.onError(err);
                reject(err);
            });

            worker.on('exit', (code) => {
                if (options.onExit) options.onExit(code);
                if (code !== 0) {
                    reject(new Error(`Worker ${workerName} stopped with exit code ${code}`));
                }
            });
        });
    }

    /**
     * Resolves the worker path based on the environment.
     * Priority:
     * 1. src-electron/workers/[name].ts (Local Dev)
     * 2. currentDir/workers/[name].js (Built Prod alongside main)
     * 3. currentDir/[name].js (Fallback for top-level workers)
     */
    private static resolveWorkerPath(workerName: string): string {
        // 1. Check for TS source (Dev)
        const tsPath = path.resolve(process.cwd(), 'src-electron', 'workers', `${workerName}.ts`);
        if (fs.existsSync(tsPath)) return tsPath;

        // Alternative Dev Path (some workers were in utils/)
        const tsUtilsPath = path.resolve(process.cwd(), 'src-electron', 'utils', `${workerName}.ts`);
        if (fs.existsSync(tsUtilsPath)) return tsUtilsPath;

        // 2. Check for JS build (Prod - alongside main)
        const prodPath = path.resolve(__dirname, 'workers', `${workerName}.js`);
        if (fs.existsSync(prodPath)) return prodPath;

        // 3. Fallback to same dir (Prod fallback)
        const fallbackPath = path.resolve(__dirname, `${workerName}.js`);
        if (fs.existsSync(fallbackPath)) return fallbackPath;

        // If none found, return the most likely production path and hope for the best
        return prodPath;
    }
}
