
import { synth } from './synth-engine';

export class SynthClient {
    private workerCount = 0;
    private workerRoundRobin = 0;
    // Map stopId to workerIndex
    private stopToWorker: Record<string, number> = {};
    private isDistributed = false;

    constructor() { }

    async init(workerCount: number) {
        if (workerCount <= 0) {
            this.isDistributed = false;
            this.workerCount = 0;
            return;
        }

        this.workerCount = workerCount;
        this.isDistributed = true;
        this.stopToWorker = {};

        // Initialize workers in main process
        await window.myApi.createWorkers(workerCount);

        // Wait for workers to report ready
        console.log(`[SynthClient] Waiting for ${workerCount} workers to be ready...`);
        await new Promise<void>((resolve) => {
            const readySet = new Set<number>();
            const cleanup = window.myApi.onWorkerReady((index: number) => {
                readySet.add(index);
                console.log(`[SynthClient] Worker ${index} ready. (${readySet.size}/${workerCount})`);
                if (readySet.size >= workerCount) {
                    cleanup();
                    resolve();
                }
            });

            // Fallback timeout (in case of error)
            setTimeout(() => {
                if (readySet.size < workerCount) {
                    console.warn(`[SynthClient] Timeout waiting for workers. only ${readySet.size}/${workerCount} ready.`);
                    cleanup();
                    resolve();
                }
            }, 5000);
        });

        console.log(`[SynthClient] Initialized ${workerCount} workers`);
    }

    private getWorkerForStop(stopId: string): number {
        if (this.stopToWorker[stopId] !== undefined) {
            return this.stopToWorker[stopId];
        }

        // Assign to worker with fewest stops
        const counts = new Array(this.workerCount).fill(0);
        Object.values(this.stopToWorker).forEach(w => counts[w]++);

        let minCount = Infinity;
        let worker = 0;

        // Find worker with minimum stops
        // Iterate to find the first worker with the minimum count
        for (let i = 0; i < this.workerCount; i++) {
            if (counts[i] < minCount) {
                minCount = counts[i];
                worker = i;
            }
        }

        this.stopToWorker[stopId] = worker;
        console.log(`[SynthClient] Assigned stop ${stopId} to worker ${worker} (Load: ${counts[worker]} -> ${counts[worker] + 1})`);
        return worker;
    }

    async loadSample(stopId: string, pipePath: string, type: 'partial' | 'full' = 'partial'): Promise<void> {
        if (!this.isDistributed) {
            return synth.loadSample(stopId, pipePath, type);
        }

        const worker = this.getWorkerForStop(stopId);
        window.myApi.sendWorkerCommand(worker, {
            type: 'load-sample',
            stopId,
            pipePath,
            loadType: type
        });
    }

    noteOn(
        note: number,
        stopId: string,
        pipePath: string,
        releasePath: string | undefined,
        volume: number,
        gainDb: number,
        tuning: number = 0,
        harmonicNumber: number = 1,
        isPedal: boolean = false,
        manualId?: string,
        activeTremulants: any[] = [],
        pitchOffsetCents: number = 0,
        renderingNote?: number,
        delay: number = 0
    ) {
        if (!this.isDistributed) {
            synth.noteOn(note, stopId, pipePath, releasePath, volume, gainDb, tuning, harmonicNumber, isPedal, manualId, activeTremulants, pitchOffsetCents, renderingNote, delay);
            return;
        }

        const worker = this.getWorkerForStop(stopId);
        window.myApi.sendWorkerCommand(worker, {
            type: 'note-on',
            note,
            stopId,
            pipePath,
            releasePath,
            volume,
            gainDb,
            tuning,
            harmonicNumber,
            isPedal,
            manualId,
            activeTremulants,
            pitchOffsetCents,
            renderingNote,
            delay
        });
    }

    noteOff(note: number, stopId: string) {
        if (!this.isDistributed) {
            synth.noteOff(note, stopId);
            return;
        }
        const worker = this.getWorkerForStop(stopId);
        window.myApi.sendWorkerCommand(worker, {
            type: 'note-off',
            note,
            stopId
        });
    }

    setGlobalGain(db: number) {
        if (!this.isDistributed) {
            synth.setGlobalGain(db);
            return;
        }
        // Broadcast to all workers
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'set-global-gain',
                db
            });
        }
    }

    // ... Other methods pass-through or broadcast

    markStopSelected(stopId: string) {
        if (!this.isDistributed) {
            synth.markStopSelected(stopId);
            return;
        }
        // Workers don't strictly need to know this unless we optimize memory there
        // But let's keep track locally or broadcast if needed
    }

    markStopDeselected(stopId: string) {
        if (!this.isDistributed) {
            synth.markStopDeselected(stopId);
            return;
        }
        const worker = this.getWorkerForStop(stopId);
        // Maybe tell worker to unload?
    }

    updateTremulants(allActiveTremulants: any[]) {
        if (!this.isDistributed) {
            synth.updateTremulants(allActiveTremulants);
            return;
        }
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'update-tremulants',
                allActiveTremulants
            });
        }
    }

    setTsunamiMode(enabled: boolean) {
        if (!this.isDistributed) {
            synth.setTsunamiMode(enabled);
            return;
        }
        // Broadcast
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'set-tsunami-mode',
                enabled
            });
        }
    }

    setUseReleaseSamples(enabled: boolean) {
        if (!this.isDistributed) {
            synth.setUseReleaseSamples(enabled);
            return;
        }
        // Broadcast
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'set-use-release-samples',
                enabled
            });
        }
    }

    unloadSamples() {
        if (!this.isDistributed) {
            synth.unloadSamples();
            return;
        }
        // Broadcast
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'unload-samples'
            });
        }
    }

    getStats() {
        if (!this.isDistributed) {
            return synth.getStats();
        }
        // Ideally we aggregate stats from workers via IPC request/response.
        // For now, return placeholders or last known stats.
        return {
            activeStops: Object.keys(this.stopToWorker).length,
            partialSamples: 0,
            fullSamples: 0,
            totalRamEstimateBytes: 0,
            activeVoices: 0,
            loadingTasks: 0
        };
    }
}

export const synthClient = new SynthClient();
