
import { synth } from './synth-engine';

export class SynthClient {
    private workerCount = 0;
    private workerRoundRobin = 0;
    // Map stopId to workerIndex
    private stopToWorker: Record<string, number> = {};
    private isDistributed = false;

    private cachedGlobalGain = 0;
    private cachedReleaseMode: 'authentic' | 'convolution' | 'none' = 'authentic';
    private cachedReverbParams = { length: 2.0, mix: 0.3 };

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

        // Set up listener BEFORE creating workers to avoid race conditions
        const readyPromise = new Promise<void>((resolve) => {
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
            }, 10000); // Increased timeout to 10s for stability
        });

        // Initialize workers in main process
        await window.myApi.createWorkers(workerCount);

        // Wait for workers to report ready
        console.log(`[SynthClient] Waiting for ${workerCount} workers to be ready...`);
        await readyPromise;

        console.log(`[SynthClient] Initialized ${workerCount} workers`);
        this.syncWorkers();
    }

    private syncWorkers() {
        if (!this.isDistributed) return;
        // Broadcast cached settings to ensure new workers are in sync
        this.setGlobalGain(this.cachedGlobalGain);
        this.setReleaseMode(this.cachedReleaseMode);
        this.configureReverb(this.cachedReverbParams.length, this.cachedReverbParams.mix);
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

    async loadSampleBatch(samples: Array<{ stopId: string, pipePath: string, type: 'partial' | 'full', params?: any }>): Promise<void> {
        if (!this.isDistributed) {
            return synth.loadSampleBatch(samples);
        }

        // Group by worker
        const workerBatches: Record<number, typeof samples> = {};

        samples.forEach(s => {
            const worker = this.getWorkerForStop(s.stopId);
            if (!workerBatches[worker]) workerBatches[worker] = [];
            workerBatches[worker].push(s);
        });

        // Send commands
        Object.entries(workerBatches).forEach(([workerIndex, batch]) => {
            window.myApi.sendWorkerCommand(Number(workerIndex), {
                type: 'load-sample-batch',
                samples: batch
            });
        });
    }

    async loadSample(stopId: string, pipePath: string, type: 'partial' | 'full' = 'partial', params?: { maxDuration?: number, cropToLoop?: boolean }): Promise<void> {
        if (!this.isDistributed) {
            return synth.loadSample(stopId, pipePath, type, params);
        }

        const worker = this.getWorkerForStop(stopId);
        window.myApi.sendWorkerCommand(worker, {
            type: 'load-sample',
            stopId,
            pipePath,
            loadType: type,
            params
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
        // Skip disabled ranks
        // We need access to the organ store, but SynthClient is a singleton service.
        // We can import the store here, but we need to use it inside the method or init.
        // Ideally SynthClient shouldn't depend on Pinia, but for practicality in this architecture:

        // Optimization: For tight loops, we might want to cache the set of disabled stops in SynthClient 
        // updated via a method call from the store's watcher. But accessing the store directly is easier.
        // Let's rely on the store being available globally or passed in.

        // Actually, importing the store directly in a service file works in Quasar/Vue3 if Pinia is active.
        // But circular dependency might be an issue (Store imports Client, Client imports Store).
        // Better: OrganStore should filter the `stopId` BEFORE calling `synth.noteOn`.

        // HOWEVER, `organ.ts` uses `this.organData.stops[stopId]` often. 
        // Let's refactor `organ.ts` `playPipe` to check `this.enabledStopIds.has(stopId)`.

        // Wait, the plan said "SynthClient only assigns stops belonging to enabled ranks".
        // But `noteOn` is per voice.

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
        this.cachedGlobalGain = db;
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

    setReleaseMode(mode: 'authentic' | 'convolution' | 'none') {
        this.cachedReleaseMode = mode;
        if (!this.isDistributed) {
            synth.setReleaseMode(mode);
            return;
        }
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'set-release-mode',
                mode
            });
        }
    }

    configureReverb(length: number, mix: number) {
        this.cachedReverbParams = { length, mix };
        if (!this.isDistributed) {
            synth.configureReverb(length, mix);
            return;
        }
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'configure-reverb',
                length,
                mix
            });
        }
    }

    async unload() {
        if (this.isDistributed) {
            await window.myApi.createWorkers(0);
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
