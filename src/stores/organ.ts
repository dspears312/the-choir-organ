import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import { synthClient as synth } from '../services/synth-client';

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
    delay?: number; // in ms
}

export interface TimelineEvent {
    timestamp: number;
    type: 'noteOn' | 'noteOff' | 'stopOn' | 'stopOff';
    note?: number;
    stopId?: string;
    velocity?: number;
}

export interface RecordingSession {
    id: string;
    name: string;
    date: number;
    duration: number; // ms
    events: TimelineEvent[];
}

export const useOrganStore = defineStore('organ', {
    state: () => ({
        organData: null as any,
        currentCombination: [] as string[],
        stopVolumes: {} as Record<string, number>,
        globalVolume: 100, // 0-100%
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
        midiError: '' as string,
        isSynthEnabled: true,
        virtualStops: [] as VirtualStop[],
        suppressDiskWarning: false,
        isOutputRemovable: false,
        availableDrives: [] as any[],
        drivePollInterval: null as any,
        isExtracting: false,
        extractionProgress: 0,
        extractionFile: '',
        isLoadingOrgan: false,
        midiListener: null as ((event: any) => void) | null,

        // Recording State
        isRecording: false,
        recordingStartTime: 0,
        currentRecordingEvents: [] as TimelineEvent[],
        recordings: [] as RecordingSession[],

        // Remote Server State
        remoteServerStatus: {
            running: false,
            port: 8080,
            ips: [] as string[]
        },
        remoteSyncCleanup: null as (() => void) | null,

        // Multi-Process
        // Multi-Process
        workerCount: 0,
        workerStats: {} as Record<number, any>
    }),
    getters: {
        totalRamUsage: (state) => {
            let total = 0;
            // Add worker stats (Process RSS)
            Object.values(state.workerStats).forEach((s: any) => {
                total += s.processMemory?.rss || s.totalRamEstimateBytes || 0;
            });
            return total;
        },
        targetVolumeLabel: (state) => {
            if (state.organData?.name) {
                const label = state.organData.name
                    .replace(/[^a-zA-Z0-9]/g, '')
                    .substring(0, 11)
                    .toUpperCase();
                return label || 'TCO';
            }
            return 'TCO';
        }
    },
    actions: {
        setGlobalVolume(percent: number) {
            this.globalVolume = percent;
            // Convert percent to dB (100% = 0dB, 0% = -inf)
            // Using a log curve approximation or just standard equation
            const db = percent > 0 ? 20 * Math.log10(percent / 100) : -100;
            synth.setGlobalGain(db);
        },

        async loadOrgan(path?: string) {
            this.isRestoring = true;
            let data;
            if (path && typeof path === 'string') {
                data = await window.myApi.selectOdfFile(path);
                this.isLoadingOrgan = true;
            } else {
                this.isLoadingOrgan = true;
                this.isExtracting = false;
                this.extractionProgress = 0;
                this.extractionFile = '';

                const startListener = () => {
                    this.isExtracting = true;
                };
                const progressListener = (_event: any, data: any) => {
                    this.extractionProgress = data.progress / 100;
                    this.extractionFile = data.file;
                };

                window.myApi.onExtractionStart(startListener);
                window.myApi.onExtractionProgress(progressListener);

                try {
                    data = await window.myApi.selectOdfFile();
                } finally {
                    this.isExtracting = false;
                }
            }

            if (data && !data.error) {
                // Initialize clean state first
                this.organData = data;
                this.banks = [];
                this.currentCombination = [];
                this.stopVolumes = {};
                this.virtualStops = []; // Isolation Fix: clear virtual stops when loading new organ
                this.recordings = []; // Isolation Fix: clear recordings when loading new organ

                // Initialize global gain
                synth.setGlobalGain(data.globalGain || 0);

                // Initialize Audio Engine with persisted worker count (min 1)
                const savedWorkerCount = parseInt(localStorage.getItem('tco-worker-count') || '1', 10);
                const initialWorkers = Math.max(1, savedWorkerCount);
                await this.configureAudioEngine(initialWorkers);

                // Initialize volumes from ODF defaults first
                Object.keys(data.stops).forEach(id => {
                    this.stopVolumes[id] = data.stops[id].volume || 100;
                });

                // Refresh recents
                this.fetchRecents();

                // Load internal saved state if exists
                const savedState = await window.myApi.loadOrganState(this.organData.sourcePath);
                if (savedState) {
                    if (savedState.banks) this.banks = savedState.banks;
                    if (savedState.stopVolumes) {
                        this.stopVolumes = { ...this.stopVolumes, ...savedState.stopVolumes };
                    }
                    if (savedState.useReleaseSamples !== undefined) {
                        this.setUseReleaseSamples(savedState.useReleaseSamples);
                    }
                    if (savedState.outputDir) {
                        this.outputDir = savedState.outputDir;
                        await this.updateDiskInfo();
                    }
                    if (savedState.virtualStops) this.virtualStops = savedState.virtualStops;
                    if (savedState.recordings) this.recordings = savedState.recordings;
                    if (savedState.remoteServerPort) this.remoteServerStatus.port = savedState.remoteServerPort;
                    if (savedState.isWebServerEnabled) {
                        console.log('[WebRemote] Auto-starting web server based on saved state');
                        this.setRemoteServerState(true);
                    }
                }

                // Start drive polling
                this.fetchDrives();
                if (this.drivePollInterval) clearInterval(this.drivePollInterval);
                this.drivePollInterval = setInterval(() => this.fetchDrives(), 5000);
            }
            this.isLoadingOrgan = false;
            this.syncRemoteState();
            setTimeout(() => { this.isRestoring = false; }, 100);
        },

        async fetchRecents() {
            this.recentFiles = await window.myApi.getRecentFiles();
        },

        toggleStop(stopId: string) {
            const index = this.currentCombination.indexOf(stopId);
            if (index === -1) {
                this.currentCombination = [...this.currentCombination, stopId];
                synth.markStopSelected(stopId);
                this.activeMidiNotes.forEach(note => {
                    this.playPipe(note, stopId);
                });
            } else {
                this.currentCombination = this.currentCombination.filter(id => id !== stopId);
                synth.markStopDeselected(stopId);
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

            if (this.isRecording) {
                const timestamp = performance.now() - this.recordingStartTime;
                this.currentRecordingEvents.push({
                    timestamp,
                    type: index === -1 ? 'stopOn' : 'stopOff',
                    stopId
                });
            }
            this.syncRemoteState();
        },

        setStopState(stopId: string, isOn: boolean) {
            const isCurrentlyOn = this.currentCombination.includes(stopId);
            if (isCurrentlyOn !== isOn) {
                this.toggleStop(stopId);
            }
        },

        clearCombination() {
            this.currentCombination.forEach(stopId => {
                synth.markStopDeselected(stopId);
                this.activeMidiNotes.forEach(note => {
                    synth.noteOff(note, stopId);
                });
            });

            if (this.isRecording) {
                const timestamp = performance.now() - this.recordingStartTime;
                this.currentCombination.forEach(stopId => {
                    this.currentRecordingEvents.push({
                        timestamp,
                        type: 'stopOff',
                        stopId
                    });
                });
            }
            this.currentCombination = [];
            this.syncRemoteState();
        },

        setTsunamiMode(enabled: boolean) {
            this.isTsunamiMode = enabled;
            synth.setTsunamiMode(enabled);
        },

        setUseReleaseSamples(enabled: boolean) {
            this.useReleaseSamples = enabled;
            synth.setUseReleaseSamples(enabled);
        },

        async configureAudioEngine(workerCount: number) {
            this.workerCount = workerCount;
            localStorage.setItem('tco-worker-count', workerCount.toString());

            // Re-initialize synth client
            await synth.init(workerCount);

            // Sync state to new workers
            synth.setGlobalGain(this.globalVolume > 0 ? 20 * Math.log10(this.globalVolume / 100) : -100);
            synth.setUseReleaseSamples(this.useReleaseSamples);
            synth.setTsunamiMode(this.isTsunamiMode);

            // Note: SynthClient now waits for readiness, so we are safe here.
        },

        async preloadStopSamples(stopId: string) {
            // No-op in on-demand mode.
        },

        initMIDI() {
            this.midiError = '';
            if (!navigator.requestMIDIAccess) {
                this.midiStatus = 'Error';
                this.midiError = 'Web MIDI API not supported in this browser.';
                return;
            }
            if (this.midiAccess) {
                this.stopMIDI();
            }
            navigator.requestMIDIAccess().then((access) => {
                this.midiAccess = access;
                this.midiStatus = access.inputs.size > 0 ? 'Connected' : 'Disconnected';

                // Store the bound listener so we can remove it even if the store instance changes (HMR)
                // We markRaw to prevent Vue from proxying the function, but to be 100% safe about reference equality
                // regarding what is stored vs what is added, we assign then read back.
                const listener = (event: any) => this.handleMIDIMessage(event);
                this.midiListener = markRaw(listener);
                const boundListener = this.midiListener;

                access.onstatechange = () => {
                    this.midiStatus = access.inputs.size > 0 ? 'Connected' : 'Disconnected';
                };
                access.inputs.forEach((input) => {
                    console.log(`[MIDI] Adding listener to input: ${input.name} (id: ${input.id})`);
                    input.addEventListener('midimessage', boundListener);
                });
            }).catch((err) => {
                this.midiStatus = 'Error';
                this.midiError = err.message || 'Failed to access MIDI devices.';
            });
        },

        initRemoteSync() {
            if (this.remoteSyncCleanup) {
                this.remoteSyncCleanup();
                this.remoteSyncCleanup = null;
            }
            this.remoteSyncCleanup = window.myApi.onRemoteToggleStop((event: any, stopId: string) => {
                this.toggleStop(stopId);
            });
            const clearCleanup = window.myApi.onRemoteClearCombination(() => {
                this.clearCombination();
            });
            const originalCleanup = this.remoteSyncCleanup;
            this.remoteSyncCleanup = () => {
                if (originalCleanup) originalCleanup();
                clearCleanup();
            };
            this.refreshRemoteStatus();

            // Initialize Worker Stats Listener
            window.myApi.onWorkerStats((event: any, payload: { workerIndex: number, stats: any }) => {
                this.workerStats[payload.workerIndex] = payload.stats;
            });
        },

        async setRemoteServerState(running: boolean) {
            if (running && !this.remoteServerStatus.running) {
                this.remoteServerStatus = await window.myApi.startWebServer(this.remoteServerStatus.port);
                this.syncRemoteState();
            } else if (!running && this.remoteServerStatus.running) {
                this.remoteServerStatus = await window.myApi.stopWebServer();
            }
            this.saveInternalState();
        },

        async toggleRemoteServer() {
            await this.setRemoteServerState(!this.remoteServerStatus.running);
        },

        async refreshRemoteStatus() {
            this.remoteServerStatus = await window.myApi.getWebServerStatus();
        },

        syncRemoteState() {
            if (this.remoteServerStatus.running && this.organData) {
                const cleanState = JSON.parse(JSON.stringify({
                    organData: {
                        name: this.organData?.name,
                        manuals: this.organData?.manuals?.map((m: any) => ({
                            id: m.id,
                            name: m.name,
                            stopIds: m.stopIds
                        })),
                        stops: Object.fromEntries(
                            Object.entries(this.organData?.stops || {}).map(([id, s]: [string, any]) => [
                                id,
                                { id: s.id, name: s.name, pitch: s.pitch }
                            ])
                        ),
                        screens: this.organData?.screens || [],
                        activeScreenIndex: this.organData?.activeScreenIndex || 0
                    },
                    activatedStops: [...this.currentCombination]
                }));
                window.myApi.updateRemoteState(cleanState);
            } else if (!this.organData) {
                console.warn('[Remote] syncRemoteState called but organData is null');
            }
        },

        stopMIDI() {
            if (this.midiAccess) {
                console.log('[MIDI] Stopping MIDI service and removing listeners...');
                const listener = this.midiListener || this.handleMIDIMessage;
                this.midiAccess.inputs.forEach((input) => {
                    console.log(`[MIDI] Removing listener from input: ${input.name}`);
                    input.removeEventListener('midimessage', listener as EventListener);
                });
                this.midiListener = null;
                this.midiAccess.onstatechange = null;
                this.midiAccess = null;
            }
            this.midiStatus = 'Disconnected';
            this.midiError = '';
        },

        async handleMIDIMessage(event: any) {
            const [status, note, velocity] = event.data;
            const type = status & 0xf0;
            console.log(`[MIDI] Event: Status=${status}, Note=${note}, Velocity=${velocity}, Type=${type}`);

            if (type === 144 && velocity > 0) { // Note On
                this.activeMidiNotes.add(note);
                if (this.isRecording) {
                    this.currentRecordingEvents.push({
                        timestamp: performance.now() - this.recordingStartTime,
                        type: 'noteOn',
                        note,
                        velocity
                    });
                }
                if (this.isSynthEnabled) {
                    // Fire all stop playbacks in parallel
                    this.currentCombination.forEach((stopId) => {
                        this.playPipe(note, stopId);
                    });
                }
            } else if (type === 128 || (type === 144 && velocity === 0)) { // Note Off
                this.activeMidiNotes.delete(note);
                if (this.isRecording) {
                    this.currentRecordingEvents.push({
                        timestamp: performance.now() - this.recordingStartTime,
                        type: 'noteOff',
                        note,
                        velocity: 0
                    });
                }
                if (this.isSynthEnabled) {
                    this.currentCombination.forEach(stopId => {
                        synth.noteOff(note, stopId);
                    });
                }
            }
        },

        async playPipe(note: number, stopId: string) {
            let actualStopId = stopId;
            let pitchShift = 0;
            let harmonicMultiplier = 1;
            let noteOffset = 0;

            let vs: VirtualStop | undefined;
            if (stopId.startsWith('VIRT_')) {
                vs = this.virtualStops.find(v => v.id === stopId);
                if (!vs) return;
                actualStopId = vs.originalStopId;
                pitchShift = vs.pitchShift || 0;
                harmonicMultiplier = vs.harmonicMultiplier || 1;
                noteOffset = vs.noteOffset || 0;
            }

            const stop = this.organData.stops[actualStopId];
            if (!stop) return;

            const adjustedNote = note + noteOffset;

            // Fire all ranks in parallel
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
                        // Don't await here, let synth.noteOn handle its own wait and global throttle
                        synth.noteOn(
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
                            adjustedNote,
                            vs?.delay || 0
                        );
                    }
                }
            });
        },

        setStopVolume(stopId: string, volume: number) {
            this.stopVolumes[stopId] = volume;
        },

        async setOutputDir() {
            const dir = await window.myApi.selectFolder();
            if (dir) {
                this.outputDir = dir;
                await this.updateDiskInfo();
            }
        },

        async updateDiskInfo() {
            if (!this.outputDir) {
                this.isOutputRemovable = false;
                return;
            }
            const info = await window.myApi.getDiskInfo(this.outputDir);
            this.isOutputRemovable = !!(info && info.isRemovable);
        },

        async fetchDrives() {
            const drives = await window.myApi.listRemovableDrives();
            this.availableDrives = drives;

            // Auto-select TCO drive if nothing selected
            if (!this.outputDir && drives.length > 0) {
                const target = drives.find((d: any) => d.volumeName === this.targetVolumeLabel) ||
                    drives.find((d: any) => d.volumeName === 'TCO');
                if (target) {
                    this.outputDir = target.mountPoint;
                    this.isOutputRemovable = true;
                }
            }
        },

        async checkOutputPath() {
            if (!this.outputDir) return { type: 'none' };
            const info = await window.myApi.getDiskInfo(this.outputDir);
            if (info && info.isRemovable && info.isRoot) {
                return { type: 'removable_root', info };
            }
            if (!this.suppressDiskWarning) {
                return { type: 'local_folder' };
            }
            return { type: 'proceed' };
        },

        async formatOutputVolume() {
            if (!this.outputDir) return;
            this.isRendering = true;
            this.renderStatus = 'Formatting volume...';

            const label = this.targetVolumeLabel;

            try {
                const result = await window.myApi.formatVolume(this.outputDir, label);
                if (result.success && result.newPath) {
                    this.outputDir = result.newPath;
                    this.renderStatus = 'Format successful.';
                    await this.updateDiskInfo();
                } else if (result.success) {
                    this.renderStatus = `Format successful as ${label}. Remounting...`;
                }
            } catch (e: any) {
                this.renderStatus = `Format failed: ${e.message}`;
                throw e;
            } finally {
                this.isRendering = false;
            }
        },

        cancelRendering() {
            window.myApi.cancelRendering();
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
                synth.markStopDeselected(id);
                if (this.isSynthEnabled) {
                    this.activeMidiNotes.forEach(note => synth.noteOff(note, id));
                }
                if (this.isRecording) {
                    this.currentRecordingEvents.push({
                        timestamp: performance.now() - this.recordingStartTime,
                        type: 'stopOff',
                        stopId: id
                    });
                }
            });

            contentToTurnOn.forEach(id => {
                if (!this.currentCombination.includes(id)) {
                    this.currentCombination.push(id);
                    synth.markStopSelected(id);
                    this.activeMidiNotes.forEach(note => this.playPipe(note, id));
                }
                if (this.isRecording) {
                    this.currentRecordingEvents.push({
                        timestamp: performance.now() - this.recordingStartTime,
                        type: 'stopOn',
                        stopId: id
                    });
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
                this.virtualStops.splice(index, 1, { ...updatedStop });
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
                            noteOffset: vs.noteOffset || 0,
                            delay: vs.delay || 0
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
                    bankName: bank.name,
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
                virtualStops: this.virtualStops,
                recordings: this.recordings,
                isWebServerEnabled: this.remoteServerStatus.running,
                remoteServerPort: this.remoteServerStatus.port
            }));
            await (window as any).myApi.saveOrganState(this.organData.sourcePath, state);
        },

        startRecording() {
            this.isRecording = true;
            this.recordingStartTime = performance.now();
            this.currentRecordingEvents = [];

            // Capture initial state
            this.currentCombination.forEach(stopId => {
                this.currentRecordingEvents.push({
                    timestamp: 0,
                    type: 'stopOn',
                    stopId
                });
            });
        },

        stopRecording() {
            if (!this.isRecording) return;
            this.isRecording = false;

            if (this.currentRecordingEvents.length === 0) return;

            const duration = performance.now() - this.recordingStartTime;
            const newRecording: RecordingSession = {
                id: crypto.randomUUID(),
                name: `Recording ${this.recordings.length + 1}`,
                date: Date.now(),
                duration: duration,
                events: [...this.currentRecordingEvents]
            };

            this.recordings.unshift(newRecording);
            this.saveInternalState();
        },

        deleteRecording(id: string) {
            this.recordings = this.recordings.filter(r => r.id !== id);
            this.saveInternalState();
        },

        renameRecording(id: string, newName: string) {
            const rec = this.recordings.find(r => r.id === id);
            if (rec) {
                rec.name = newName;
                this.saveInternalState();
            }
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
        },

        async removeRecent(path: string) {
            await window.myApi.removeFromRecent(path);
            await this.fetchRecents();
        },

        async getOrganSize(path: string) {
            const result = await window.myApi.calculateOrganSize(path);
            return result.size || 0;
        },

        async deleteOrgan(path: string) {
            const result = await window.myApi.deleteOrganFiles(path);
            if (result.success) {
                await this.fetchRecents();
                return { success: true };
            }
            return { success: false, error: result.error };
        },

        async performCleanup() {
            // Stop audio capability
            this.stopMIDI();

            // Explicitly unload samples from synth engine
            synth.unloadSamples();

            // Clear data references to allow GC
            this.organData = null;

            this.banks = [];
            this.currentCombination = [];
            this.stopVolumes = {};
            this.virtualStops = [];

            // Trigger Garbage Collection
            if ((window as any).gc) {
                try {
                    (window as any).gc();
                    console.log('Manual GC triggered in Renderer');
                } catch (e) {
                    console.warn('Renderer GC failed (run with --expose-gc)', e);
                }
            } else {
                console.warn('window.gc is undefined. Run with --js-flags="--expose-gc"');
            }

            // Trigger Main Process GC
            if ((window as any).myApi?.triggerGC) {
                await (window as any).myApi.triggerGC();
            }
        }
    }
});

