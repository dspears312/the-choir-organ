import { parentPort, workerData } from 'worker_threads';
import { renderPerformance } from '../utils/renderer';

async function run() {
    try {
        console.log('[Worker] Starting render job...');
        const { recording, organData, outputPath, renderTails, banks } = workerData;
        console.log(`[Worker] Output path: ${outputPath}`);
        console.log(`[Worker] Tails: ${renderTails}`);

        await renderPerformance(
            recording,
            organData,
            outputPath,
            renderTails,
            banks,
            (progress: number) => {
                if (progress % 10 === 0) console.log(`[Worker] Progress: ${progress}%`);
                parentPort?.postMessage({ type: 'progress', progress });
            }
        );

        console.log('[Worker] Render complete.');
        parentPort?.postMessage({ type: 'success', filePath: outputPath });
    } catch (error: any) {
        console.error('[Worker] Error:', error);
        parentPort?.postMessage({ type: 'error', error: error.message });
    }
}

run();
