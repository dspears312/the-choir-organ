import { defineStore } from 'pinia';
import { synth } from '../services/synth-engine';

export interface Bank {
    id: string; // unique ID for reordering
    name: string;
    combination: string[];
    stopVolumes: Record<string, number>;
}

export interface VirtualStop {
    id: string;
    originalStopId: string;
    name: string;
    pitch: string;
    pitchShift: number; // in cents
    harmonicMultiplier: number;
    noteOffset: number;
    volume?: number;
}

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
        midiAccess: null as MIDIAccess | null,
        virtualStops: [] as VirtualStop[]
    }),
    actions: {
        async loadOrgan(path?: string) {
            this.isRestoring = true;
            let data;
            if (path && typeof path === 'string') {
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
                this.virtualStops = []; // Isolation Fix: clear virtual stops when loading new organ

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

                // Load internal saved state if exists
                const savedState = await (window as any).myApi.loadOrganState(this.organData.sourcePath);
                if (savedState) {
                    if (savedState.banks) this.banks = savedState.banks;
                    if (savedState.stopVolumes) {
                        this.stopVolumes = { ...this.stopVolumes, ...savedState.stopVolumes };
                    }
                    if (savedState.useReleaseSamples !== undefined) {
                        this.setUseReleaseSamples(savedState.useReleaseSamples);
                    }
                    if (savedState.outputDir) this.outputDir = savedState.outputDir;
                    if (savedState.virtualStops) this.virtualStops = savedState.virtualStops;
                }
            } else if (data?.error) {
                console.error(data.error);
            }
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
                this.activeMidiNotes.forEach(note => {
                    this.playPipe(note, stopId);
                });
            } else {
                this.currentCombination.splice(index, 1);
                this.activeMidiNotes.forEach(note => {
                    synth.noteOff(note, stopId);
                });
            }

            if (stopId.startsWith('TREM_')) {
                const activeTrems = this.currentCombination
                    .filter(id => id.startsWith('TREM_'))
                    .map(id => this.organData.tremulants[id.replace('TREM_', '')])
                    .filter(t => !!t);
                synth.updateTremulants(activeTrems);
            }
        },

        clearCombination() {
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
            let actualStopId = stopId;
            if (stopId.startsWith('VIRT_')) {
                const vs = this.virtualStops.find(v => v.id === stopId);
                if (!vs) return;
                actualStopId = vs.originalStopId;
            }

            const stop = this.organData.stops[actualStopId];
            if (!stop) return;

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
            let actualStopId = stopId;
            let pitchShift = 0;
            let harmonicMultiplier = 1;
            let noteOffset = 0;

            if (stopId.startsWith('VIRT_')) {
                const vs = this.virtualStops.find(v => v.id === stopId);
                if (!vs) return;
                actualStopId = vs.originalStopId;
                pitchShift = vs.pitchShift || 0;
                harmonicMultiplier = vs.harmonicMultiplier || 1;
                noteOffset = vs.noteOffset || 0;
            }

            const stop = this.organData.stops[actualStopId];
            if (!stop) return;

            const adjustedNote = note + noteOffset;

            stop.rankIds.forEach(async (rankId: string) => {
                const rank = this.organData.ranks[rankId];
                if (rank) {
                    const pipe = rank.pipes.find((p: any) => p.midiNote === adjustedNote) || rank.pipes[adjustedNote - 36];
                    if (pipe) {
                        const manual = this.organData.manuals.find((m: any) => String(m.id) === String(stop.manualId));
                        const isPedal = manual?.name.toLowerCase().includes('pedal') || false;
                        const combinedGain = (manual?.gain || 0) + (stop.gain || 0) + (rank.gain || 0) + (pipe.gain || 0);

                        const activeTremulants = this.currentCombination
                            .filter(id => id.startsWith('TREM_'))
                            .map(id => {
                                const tremId = id.replace('TREM_', '');
                                return this.organData.tremulants[tremId];
                            })
                            .filter(trem => trem && (!trem.manualId || String(trem.manualId) === String(manual?.id)));

                        // note is the original key (for release tracking)
                        // adjustedNote is the target pitch base
                        await synth.noteOn(
                            note,
                            stopId,
                            pipe.wavPath,
                            pipe.releasePath,
                            this.stopVolumes[stopId] || 100,
                            combinedGain,
                            0, // ODF tuning ignored
                            (pipe.harmonicNumber || 1) * harmonicMultiplier,
                            isPedal,
                            manual?.id,
                            activeTremulants,
                            pitchShift,
                            adjustedNote
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
            this.stopVolumes = { ...this.stopVolumes, ...bank.stopVolumes };
            const newCombo = new Set(bank.combination);
            const contentToTurnOff = this.currentCombination.filter(id => !newCombo.has(id));
            const contentToTurnOn = bank.combination.filter(id => !this.currentCombination.includes(id));

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

        addVirtualStop(stop: VirtualStop) {
            this.virtualStops.push(stop);
        },

        updateVirtualStop(updatedStop: VirtualStop) {
            const index = this.virtualStops.findIndex(v => v.id === updatedStop.id);
            if (index > -1) {
                this.virtualStops[index] = { ...updatedStop };
            }
        },

        deleteVirtualStop(id: string) {
            this.virtualStops = this.virtualStops.filter(v => v.id !== id);
            this.currentCombination = this.currentCombination.filter(x => x !== id);
            this.banks.forEach(bank => {
                bank.combination = bank.combination.filter(x => x !== id);
            });
        },

        saveToBank(bankNumber: number) {
            if (this.banks[bankNumber]) {
                this.banks[bankNumber].combination = [...this.currentCombination];
                this.banks[bankNumber].stopVolumes = { ...this.stopVolumes };
            }
        },

        async renderAll() {
            if (!this.organData || this.banks.length === 0) return;
            this.isRendering = true;
            this.renderStatus = 'Starting batch render...';
            try {
                for (let i = 0; i < this.banks.length; i++) {
                    this.renderStatus = `Rendering Bank ${i + 1} / ${this.banks.length}...`;
                    const result = await this.renderBank(i, true);
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

            const progressListener = (_event: any, progress: number) => {
                this.renderProgress = progress / 100;
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

                this.virtualStops.forEach(vs => {
                    const originalStop = this.organData.stops[vs.originalStopId];
                    if (originalStop) {
                        cleanStops[vs.id] = {
                            id: vs.id,
                            name: vs.name,
                            rankIds: [...originalStop.rankIds],
                            manualId: originalStop.manualId,
                            volume: bank.stopVolumes[vs.id] ?? vs.volume ?? 100,
                            gain: originalStop.gain || 0,
                            pitchShift: vs.pitchShift || 0,
                            harmonicMultiplier: vs.harmonicMultiplier || 1,
                            noteOffset: vs.noteOffset || 0
                        };
                    }
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
            if (!this.organData || !this.organData.sourcePath) return;
            const state = JSON.parse(JSON.stringify({
                banks: this.banks,
                stopVolumes: this.stopVolumes,
                useReleaseSamples: this.useReleaseSamples,
                outputDir: this.outputDir,
                virtualStops: this.virtualStops
            }));
            await (window as any).myApi.saveOrganState(this.organData.sourcePath, state);
        },

        exportToJSON() {
            const data = {
                organName: this.organData?.name,
                banks: this.banks,
                stopVolumes: this.stopVolumes,
                currentCombination: this.currentCombination,
                useReleaseSamples: this.useReleaseSamples,
                virtualStops: this.virtualStops
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
                        if (content.virtualStops) this.virtualStops = content.virtualStops;
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
