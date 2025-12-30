import { defineStore } from 'pinia';
import { synth } from '../services/synth-engine';

export interface Bank {
    id: string; // unique ID for reordering
    name: string;
    combination: string[];
    stopVolumes: Record<string, number>;
}

// Add electron API type for listeners if needed, or cast window


export const useOrganStore = defineStore('organ', {
    state: () => ({
        organData: null as any,
        currentCombination: [] as string[],
        stopVolumes: {} as Record<string, number>,
        banks: [] as Bank[],
        isRendering: false,
        outputDir: '',
        midiStatus: 'Disconnected' as 'Disconnected' | 'Connected' | 'Error',
        isTsunamiMode: false,
        useReleaseSamples: false,
        activeMidiNotes: new Set<number>(),
        recentFiles: [] as string[],
        renderProgress: 0,
        renderStatus: '',
        isRestoring: false,
        midiAccess: null as MIDIAccess | null
    }),
    actions: {
        async loadOrgan(path?: string) {
            this.isRestoring = true;
            let data;
            if (path && typeof path === 'string') {
                // path is strict string
                data = await (window as any).myApi.selectOdfFile(path);
            } else {
                data = await (window as any).myApi.selectOdfFile();
            }

            if (data && !data.error) {
                // Initialize clean state first
                this.organData = data;
                this.banks = [];
                this.currentCombination = [];
                this.stopVolumes = {};

                // Initialize global gain
                synth.setGlobalGain(data.globalGain || 0);

                // Initialize volumes from ODF defaults first
                Object.keys(data.stops).forEach(id => {
                    this.stopVolumes[id] = data.stops[id].volume || 100;
                });

                // Setup MIDI
                this.initMIDI();
                // Refresh recents
                this.fetchRecents();

                // Load internal saved state if exists (using unique sourcePath)
                const savedState = await (window as any).myApi.loadOrganState(this.organData.sourcePath);
                if (savedState) {
                    if (savedState.banks) this.banks = savedState.banks;

                    // Merge volumes: ODF defaults overwritten by saved state
                    if (savedState.stopVolumes) {
                        this.stopVolumes = { ...this.stopVolumes, ...savedState.stopVolumes };
                    }
                    if (savedState.useReleaseSamples !== undefined) {
                        this.setUseReleaseSamples(savedState.useReleaseSamples);
                    }
                    if (savedState.outputDir) this.outputDir = savedState.outputDir;
                }
            } else if (data?.error) {
                console.error(data.error);
            }
            // Ensure we unset restoring flag even if error, but wait for next tick to let watchers settle if needed?
            // Actually synchronous unset is fine, watcher in component will run after this action completes (microtask).
            setTimeout(() => { this.isRestoring = false; }, 100);
        },

        async fetchRecents() {
            this.recentFiles = await (window as any).myApi.getRecentFiles();
        },

        toggleStop(stopId: string) {
            const index = this.currentCombination.indexOf(stopId);
            if (index === -1) {
                this.currentCombination.push(stopId);
                this.preloadStopSamples(stopId);
                // Trigger for all active notes
                this.activeMidiNotes.forEach(note => {
                    this.playPipe(note, stopId);
                });
            } else {
                this.currentCombination.splice(index, 1);
                // Stop for all active notes
                this.activeMidiNotes.forEach(note => {
                    synth.noteOff(note, stopId);
                });
            }

            // Real-time tremulant update
            if (stopId.startsWith('TREM_')) {
                const activeTrems = this.currentCombination
                    .filter(id => id.startsWith('TREM_'))
                    .map(id => this.organData.tremulants[id.replace('TREM_', '')])
                    .filter(t => !!t);
                synth.updateTremulants(activeTrems);
            }
        },

        clearCombination() {
            // Stop all playing pipes for all active stops
            this.currentCombination.forEach(stopId => {
                this.activeMidiNotes.forEach(note => {
                    synth.noteOff(note, stopId);
                });
            });
            this.currentCombination = [];
        },

        setTsunamiMode(enabled: boolean) {
            this.isTsunamiMode = enabled;
            synth.setTsunamiMode(enabled);
        },

        setUseReleaseSamples(enabled: boolean) {
            this.useReleaseSamples = enabled;
            synth.setUseReleaseSamples(enabled);
        },

        async preloadStopSamples(stopId: string) {
            if (!this.organData) return;
            const stop = this.organData.stops[stopId];
            if (!stop) return;

            // For real-time, we preload all pipes for this stop's ranks.
            // This might be slow for huge organs, but essential for zero-latency.
            for (const rankId of stop.rankIds) {
                const rank = this.organData.ranks[rankId];
                if (rank) {
                    for (const pipe of rank.pipes) {
                        await synth.loadSample(stopId, pipe.wavPath);
                        if (pipe.releasePath) {
                            await synth.loadSample(stopId, pipe.releasePath);
                        }
                    }
                }
            }
        },

        initMIDI() {
            if (!navigator.requestMIDIAccess) {
                this.midiStatus = 'Error';
                return;
            }

            // Cleanup existing if any
            if (this.midiAccess) {
                this.stopMIDI();
            }

            navigator.requestMIDIAccess().then((access) => {
                this.midiAccess = access;
                this.midiStatus = access.inputs.size > 0 ? 'Connected' : 'Disconnected';

                access.onstatechange = () => {
                    this.midiStatus = access.inputs.size > 0 ? 'Connected' : 'Disconnected';
                };

                access.inputs.forEach((input) => {
                    input.onmidimessage = (message) => this.handleMIDIMessage(message);
                });
            }).catch(() => {
                this.midiStatus = 'Error';
            });
        },

        stopMIDI() {
            if (this.midiAccess) {
                this.midiAccess.inputs.forEach((input) => {
                    input.onmidimessage = null;
                });
                this.midiAccess.onstatechange = null;
                this.midiAccess = null;
            }
            this.midiStatus = 'Disconnected';
        },

        async handleMIDIMessage(event: any) {
            const [status, note, velocity] = event.data;
            const type = status & 0xf0;

            if (type === 144 && velocity > 0) { // Note On
                this.activeMidiNotes.add(note);
                this.currentCombination.forEach(async (stopId) => {
                    await this.playPipe(note, stopId);
                });
            } else if (type === 128 || (type === 144 && velocity === 0)) { // Note Off
                this.activeMidiNotes.delete(note);
                this.currentCombination.forEach(stopId => {
                    synth.noteOff(note, stopId);
                });
            }
        },

        async playPipe(note: number, stopId: string) {
            const stop = this.organData.stops[stopId];
            if (!stop) return;

            stop.rankIds.forEach(async (rankId: string) => {
                const rank = this.organData.ranks[rankId];
                if (rank) {
                    const pipe = rank.pipes.find((p: any) => p.midiNote === note) || rank.pipes[note - 36];
                    if (pipe) {
                        const manual = this.organData.manuals.find((m: any) => String(m.id) === String(stop.manualId));
                        const isPedal = manual?.name.toLowerCase().includes('pedal') || false;

                        // Unified Gain Summation (Manual + Stop + Rank + Pipe)
                        // Organ Global Gain is handled by SynthEngine masterGain
                        const combinedGain = (manual?.gain || 0) + (stop.gain || 0) + (rank.gain || 0) + (pipe.gain || 0);

                        // Find active tremulants for this manual
                        const activeTremulants = this.currentCombination
                            .filter(id => id.startsWith('TREM_'))
                            .map(id => {
                                const tremId = id.replace('TREM_', '');
                                return this.organData.tremulants[tremId];
                            })
                            .filter(trem => trem && (!trem.manualId || String(trem.manualId) === String(manual?.id)));

                        await synth.noteOn(
                            note,
                            stopId,
                            pipe.wavPath,
                            pipe.releasePath,
                            this.stopVolumes[stopId] || 100,
                            combinedGain,
                            pipe.tuning || 0,
                            pipe.harmonicNumber || 1,
                            isPedal,
                            manual?.id,
                            activeTremulants
                        );
                    }
                }
            });
        },

        setStopVolume(stopId: string, volume: number) {
            this.stopVolumes[stopId] = volume;
        },

        async setOutputDir() {
            const dir = await (window as any).myApi.selectFolder();
            if (dir) {
                this.outputDir = dir;
            }
        },

        cancelRendering() {
            (window as any).myApi.cancelRendering();
            this.renderStatus = 'Cancelling...';
        },

        addBank() {
            if (this.banks.length >= 32) return false;

            const newBank: Bank = {
                id: crypto.randomUUID(),
                name: `Bank ${this.banks.length + 1}`,
                combination: [...this.currentCombination],
                stopVolumes: { ...this.stopVolumes }
            };
            this.banks.push(newBank);
            return true;
        },

        loadBank(index: number) {
            const bank = this.banks[index];
            if (!bank) return;

            // Apply volumes first
            this.stopVolumes = { ...this.stopVolumes, ...bank.stopVolumes };

            // Identify stops to turn off vs on
            const newCombo = new Set(bank.combination);
            const contentToTurnOff = this.currentCombination.filter(id => !newCombo.has(id));
            const contentToTurnOn = bank.combination.filter(id => !this.currentCombination.includes(id));

            // Execute changes
            contentToTurnOff.forEach(id => {
                this.currentCombination = this.currentCombination.filter(x => x !== id);
                this.activeMidiNotes.forEach(note => synth.noteOff(note, id));
            });

            contentToTurnOn.forEach(id => {
                if (!this.currentCombination.includes(id)) {
                    this.currentCombination.push(id);
                    this.preloadStopSamples(id);
                    this.activeMidiNotes.forEach(note => this.playPipe(note, id));
                }
            });
        },

        deleteBank(index: number) {
            this.banks.splice(index, 1);
        },

        renameBank(index: number, newName: string) {
            if (this.banks[index]) {
                this.banks[index].name = newName;
            }
        },

        moveBank(fromIndex: number, toIndex: number) {
            if (toIndex < 0 || toIndex >= this.banks.length) return;
            const item = this.banks.splice(fromIndex, 1)[0];
            if (item) {
                this.banks.splice(toIndex, 0, item);
            }
        },

        // DEPRECATED: Old positional save, keeping for backward compat if needed but usually better to upgrade
        saveToBank(bankNumber: number) {
            // no-op or redirect to addBank for now as requested user flow changed to 'add to end'
            // But let's keep it capable of updating an existing index if we want 'Update Bank' feature later
            if (this.banks[bankNumber]) {
                this.banks[bankNumber].combination = [...this.currentCombination];
                this.banks[bankNumber].stopVolumes = { ...this.stopVolumes };
            }
        },

        async renderAll() {
            if (!this.organData || this.banks.length === 0) return;

            // First ensure we have an output dir (prompt user once)
            if (!this.outputDir) {
                // Trigger a dummy render or just select folder IPC?
                // Let's rely on the first renderBank call to prompt.
            }

            this.isRendering = true;
            this.renderStatus = 'Starting batch render...';

            try {
                for (let i = 0; i < this.banks.length; i++) {
                    this.renderStatus = `Rendering Bank ${i + 1} / ${this.banks.length}...`;
                    // We call renderBank internally. Note: renderBank sets isRendering=false in finally block
                    // so we need to manage that or modify renderBank. 
                    // Actually clearer to just duplicate the core rendering logic or make a private helper,
                    // but for now, let's just await renderBank and reset isRendering to true immediately if needed.
                    // Wait, calling renderBank will trigger the prompt if outputDir is empty.

                    const result = await this.renderBank(i, true); // Pass true to 'keepAlive' to prevent it from setting isRendering=false
                    if (result && result.status === 'cancelled') {
                        this.renderStatus = 'Batch render cancelled.';
                        break;
                    }
                }
            } catch (err) {
                console.error(err);
            } finally {
                this.isRendering = false;
                this.renderStatus = '';
                this.renderProgress = 0;
            }
        },

        async renderBank(bankNumber: number, keepAlive = false) {
            const bank = this.banks[bankNumber];
            if (!bank || !this.organData) return;

            this.isRendering = true;
            this.renderProgress = 0;

            // Listen for progress (renderer-side listener)
            const progressListener = (_event: any, progress: number) => {
                this.renderProgress = progress / 100; // 0-1 for quasar
            };
            (window as any).myApi.onRenderProgress(progressListener);

            try {
                const cleanStops: any = {};
                Object.keys(this.organData.stops).forEach(id => {
                    const s = this.organData.stops[id];
                    cleanStops[id] = {
                        id: s.id,
                        name: s.name,
                        rankIds: [...s.rankIds],
                        manualId: s.manualId,
                        volume: bank.stopVolumes[id] ?? this.stopVolumes[id] ?? 100,
                        gain: s.gain || 0
                    };
                });

                const cleanRanks: any = {};
                Object.keys(this.organData.ranks).forEach(id => {
                    const r = this.organData.ranks[id];
                    cleanRanks[id] = {
                        name: r.name,
                        gain: r.gain || 0,
                        pipes: r.pipes.map((p: any) => ({ ...p }))
                    };
                });

                const cleanManuals = this.organData.manuals.map((m: any) => ({
                    id: m.id,
                    name: m.name,
                    gain: m.gain || 0,
                    stopIds: [...m.stopIds]
                }));

                const payload = {
                    bankNumber,
                    combination: [...bank.combination],
                    organData: {
                        name: this.organData.name,
                        globalGain: this.organData.globalGain ?? 0,
                        stops: cleanStops,
                        ranks: cleanRanks,
                        manuals: cleanManuals,
                        tremulants: this.organData.tremulants || {},
                        basePath: this.organData.basePath
                    },
                    outputDir: this.outputDir
                };

                const result = await (window as any).myApi.renderBank(JSON.parse(JSON.stringify(payload)));
                if (result && result.status === 'success') {
                    this.outputDir = result.outputDir;
                } else if (result && result.status === 'cancelled') {
                    this.renderStatus = 'Render cancelled.';
                }
                return result;
            } catch (err) {
                console.error('Rendering failed:', err);
            } finally {
                if (!keepAlive) {
                    this.isRendering = false;
                    setTimeout(() => { this.renderProgress = 0; }, 1000);
                }
            }
        },

        async saveInternalState() {
            if (!this.organData || !this.organData.sourcePath) return; // Guard
            // Deep clone to remove Vue Proxies before sending over IPC
            const state = JSON.parse(JSON.stringify({
                banks: this.banks,
                stopVolumes: this.stopVolumes,
                useReleaseSamples: this.useReleaseSamples,
                outputDir: this.outputDir
            }));
            await (window as any).myApi.saveOrganState(this.organData.sourcePath, state);
        },

        exportToJSON() {
            const data = {
                organName: this.organData?.name,
                banks: this.banks,
                stopVolumes: this.stopVolumes,
                currentCombination: this.currentCombination,
                useReleaseSamples: this.useReleaseSamples
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.organData?.name || 'organ'}_config.json`;
            a.click();
            URL.revokeObjectURL(url);
        },

        async importFromJSON() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e: any) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (re: any) => {
                    try {
                        const content = JSON.parse(re.target.result);
                        if (content.banks) this.banks = content.banks;
                        if (content.stopVolumes) this.stopVolumes = content.stopVolumes;
                        if (content.currentCombination) {
                            this.currentCombination = content.currentCombination;
                            this.currentCombination.forEach(id => this.preloadStopSamples(id));
                        }
                        if (content.useReleaseSamples !== undefined) {
                            this.setUseReleaseSamples(content.useReleaseSamples);
                        }
                    } catch (err) {
                        console.error('Failed to parse JSON config', err);
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }
    }
});

