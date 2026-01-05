
import { synth } from './synth-engine';

// ... (imports remain) ...

export class SynthClient {
    private workerCount = 0;
    // Map stopId to workerIndex
    private stopToWorker: Record<string, number> = {};
    private isDistributed = false;
    private loadingMode: 'none' | 'quick' | 'full' = 'full';

    // Cache for broadcasting
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

        // Set up listener BEFORE creating workers
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

            // Fallback timeout
            setTimeout(() => {
                if (readySet.size < workerCount) {
                    console.warn(`[SynthClient] Timeout waiting for workers. only ${readySet.size}/${workerCount} ready.`);
                    cleanup();
                    resolve();
                }
            }, 15000);
        });

        // Initialize workers in main process (Main process decides if JS or Rust based on settings)
        await window.myApi.createWorkers(workerCount);

        // Wait for workers to report ready
        console.log(`[SynthClient] Waiting for ${workerCount} workers to be ready...`);
        await readyPromise;

        console.log(`[SynthClient] Initialized ${workerCount} workers`);
        this.syncWorkers();
    }

    private syncWorkers() {
        if (!this.isDistributed) return;
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
        delay: number = 0
    ) {
        // 1. Calculate Gain (Linear)
        const linearGain = Math.pow(10, gainDb / 20);
        let pedalScale = 1.0;
        if (isPedal) {
            pedalScale = Math.max(0, 1.0 - (note - 36) * (1.0 / 24));
            if (pedalScale > 1) pedalScale = 1.0; // Clamp
        }
        const finalGain = (volume / 100) * linearGain * pedalScale;

        // 2. Calculate Pitch Offset (Cents)
        console.log(note, pipePath, harmonicNumber)
        const harmonicCents = 1200 * Math.log2(harmonicNumber / 8);
        // Combine tuning, harmonic shift, and explicit offset
        const finalPitchOffset = tuning + harmonicCents + pitchOffsetCents;

        if (!this.isDistributed) {
            // If local (non-distributed, unlikely in this setup), call simplified signature?
            // Existing synth.noteOn still expects old signature unless specific overloaded.
            // For now, let's keep calling old synth.noteOn if we fallback to main process synth?
            // But synth.ts will be updated to new signature? 
            // Yes, I must update synth-engine.ts signature too. 
            // So here call with new signature logic.
            synth.noteOn(note, stopId, pipePath, releasePath, finalGain, finalPitchOffset, delay);
            return;
        }

        const worker = this.getWorkerForStop(stopId);
        window.myApi.sendWorkerCommand(worker, {
            type: 'note-on',
            note,
            stopId,
            pipePath,
            releasePath,
            gain: finalGain,
            pitchOffset: finalPitchOffset,
            delay,
            manualId,
            activeTremulants
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

    markStopSelected(stopId: string) {
        if (!this.isDistributed) {
            synth.markStopSelected(stopId);
            return;
        }
        // Optional: notify worker logic
    }

    markStopDeselected(stopId: string) {
        if (!this.isDistributed) {
            synth.markStopDeselected(stopId);
            return;
        }
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

    setLoadingMode(mode: 'none' | 'quick' | 'full') {
        this.loadingMode = mode;
        if (!this.isDistributed) {
            synth.setLoadingMode(mode);
            return;
        }

        // Broadcast to all workers 
        for (let i = 0; i < this.workerCount; i++) {
            window.myApi.sendWorkerCommand(i, {
                type: 'set-loading-mode',
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
