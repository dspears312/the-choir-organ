import { parentPort, workerData } from 'worker_threads';
import { parseODF } from '../utils/odf-parser';
import { parseHauptwerk } from '../utils/hauptwerk-parser';

async function run() {
    try {
        const { filePath } = workerData;
        console.log(`[ParserWorker] Starting parse for: ${filePath}`);

        let data;
        if (filePath.toLowerCase().endsWith('.xml') || filePath.toLowerCase().includes('_hauptwerk_xml')) {
            data = parseHauptwerk(filePath);
        } else {
            data = parseODF(filePath);
        }

        parentPort?.postMessage({ type: 'success', data });
    } catch (error: any) {
        console.error('[ParserWorker] Error:', error);
        parentPort?.postMessage({ type: 'error', error: error.message });
    }
}

run();
