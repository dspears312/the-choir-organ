import { parentPort, workerData } from 'worker_threads';
import { renderNote } from '../utils/renderer';

async function run() {
    // Persistent worker loop
    parentPort?.on('message', async (job) => {
        try {
            if (job.type === 'render') {
                const { note, pipes, trackNumber, globalGain, activeTremulants, durationMs } = job.data;

                // console.log(`[NoteWorker] Rendering note ${note}...`);

                // Pass empty string for outputDir to get buffer back
                const buffer = await renderNote(
                    note,
                    pipes,
                    '', // No output dir -> returns buffer
                    trackNumber,
                    globalGain,
                    activeTremulants,
                    undefined, // cache (worker has no shared cache, maybe implement later)
                    durationMs
                );

                parentPort?.postMessage({
                    type: 'success',
                    note,
                    buffer,
                    trackNumber
                });
            }
        } catch (error: any) {
            console.error(`[NoteWorker] Error rendering note ${job.data?.note}:`, error);
            parentPort?.postMessage({
                type: 'error',
                note: job.data?.note,
                error: error.message
            });
        }
    });
}

run();
