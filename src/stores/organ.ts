import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import MidiWriter from 'midi-writer-js';
import midiFile from 'midi-file';
import { synthClient as synth } from '../services/synth-client';
import { useSettingsStore } from './settings';
import { useExportStore } from './export';
import {
    Bank,
    VirtualStop,
    TimelineEvent,
    OrganAudioSettings,
    RecordingSession,
    DEFAULT_AUDIO_SETTINGS
} from 'src/types/models';
import { OrganModel, GenericStop, GenericRank, GenericPipe, GenericManual, GenericTremulant } from '../types/organ-model';

export const useOrganStore = defineStore('organ', {
    state: () => ({
        organData: null as OrganModel | null,
        currentCombination: [] as string[],
        stopVolumes: {} as Record<string, number>,
        globalVolume: 100, // 0-100%
        banks: [] as Bank[],
        extractionFile: '',
        isLoadingOrgan: false,
        midiListener: null as ((event: any) => void) | null,

        // MIDI State
        midiStatus: 'Disconnected' as 'Connected' | 'Disconnected' | 'Error',
        midiAccess: null as any,
        midiError: '',
        isSynthEnabled: true,
        activeMidiNotes: new Set<number>(),

        // Recording State
        isRecording: false,
        recordingStartTime: 0,
        currentRecordingEvents: [] as TimelineEvent[],
        recordings: [] as RecordingSession[],

        // Playback State
        isPlaying: false,
        playbackRecordingId: null as string | null,
        playbackStartTime: 0,
        playbackTimer: null as any,
        playbackEventIndex: 0,

        // Remote Server State
        remoteServerStatus: {
            running: false,
            port: 56789,
            ips: [] as string[]
        },
        remoteSyncCleanup: null as (() => void) | null,

        // Multi-Process
        workerCount: 0,
        workerStats: {} as Record<number, any>,

        // Advanced Audio Settings
        audioSettings: { ...DEFAULT_AUDIO_SETTINGS } as OrganAudioSettings,

        // Sample Loading Tracking
        pendingLoadCount: 0,
        totalPreloadCount: 0,
        sampleLoadListener: null as (() => void) | null,
        sampleProgressPollingInterval: null as any,
        drivePollInterval: null as any,

        // UI / Progress
        renderStatus: '',
        isExtracting: false,
        extractionProgress: 0,
        recentFiles: [] as any[],
        virtualStops: [] as VirtualStop[]
    }),
    getters: {
        enabledStopIds(state): Set<string> {
            if (!state.organData) return new Set();
            return new Set(state.currentCombination);
        },
        targetVolumeLabel(state): string {
            if (!state.organData) return 'TCO';
            const name = state.organData.name || 'Organ';
            return name.substring(0, 11).toUpperCase().replace(/[^A-Z0-9]/g, '_');
        },
        totalRamUsage(state): number {
            return Object.values(state.workerStats).reduce((acc: number, stats: any) => acc + (stats.processMemory?.rss || 0), 0);
        }
    },
    actions: {
        setGlobalVolume(percent: number) {
            this.globalVolume = percent;
            let db = percent > 0 ? 20 * Math.log10(percent / 100) : -100;

            // Apply ODF Global Gain (Attenuation)
            if (this.organData?.globalGain) {
                db += this.organData.globalGain;
            }

            synth.setGlobalGain(db);
        },

        async installOrgan() {
            let data;
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
                this.isLoadingOrgan = true;
            } finally {
                this.isExtracting = false;
            }

            if (data && !data.error) {
                this.fetchRecents();
            }
        },

        async fetchRecents() {
            this.recentFiles = await window.myApi.getRecentFiles();
        },

        async startOrgan(path: string) {
            if (!path) {
                console.error('No path specified for startOrgan');
                return;
            }

            this.isLoadingOrgan = true;
            const data = await window.myApi.selectOdfFile(path);

            if (!data || data.error) {
                console.error('Failed to load ODF file:', data.error);
                this.isLoadingOrgan = false;
                return;
            }

            this.organData = data;
            this.banks = [];
            this.currentCombination = [];
            this.stopVolumes = {};
            this.virtualStops = [];
            this.recordings = [];

            // Initialize volumes from ODF defaults first
            Object.keys(data).forEach(id => {
                if (id === 'stops') {
                    Object.keys(data.stops).forEach(stopId => {
                        this.stopVolumes[stopId] = data.stops[stopId].volume || 100;
                    });
                }
            });

            const sourcePath = this.organData.sourcePath;
            const organName = this.organData.name;
            console.log(`[OrganStore] Starting organ: ${organName} `);

            // 1. Cleanup first (Idempotency)
            // await this.stopOrgan();

            const settingsStore = useSettingsStore();
            const workerCount = Math.max(1, settingsStore.workerCount);
            console.log(`[OrganStore] Initializing ${workerCount} workers...`);

            // 2. Refresh workers
            await synth.init(workerCount);

            // Only load banks and volumes if they are empty or forced (Initial Load)
            console.log('[OrganStore] Loading state from disk...');
            const savedState = await window.myApi.loadOrganState(sourcePath);
            if (savedState) {
                if (savedState.banks) this.banks = savedState.banks;
                if (savedState.stopVolumes) {
                    this.stopVolumes = { ...this.stopVolumes, ...savedState.stopVolumes };
                }
                if (savedState.outputDir) {
                    const exportStore = useExportStore();
                    exportStore.outputDir = savedState.outputDir;
                    await exportStore.updateDiskInfo();
                }
                if (savedState.virtualStops) {
                    this.virtualStops = savedState.virtualStops;
                    // Migration: Reset 8.0 multiplier to 1.0 (baseline normalization)
                    Object.values(this.virtualStops).forEach((vs: any) => {
                        if (vs.harmonicMultiplier === 8) {
                            console.log(`[OrganStore] Migrating legacy harmonicMultiplier 8 -> 1 for vs: ${vs.id}`);
                            vs.harmonicMultiplier = 1;
                        }
                    });
                }
                if (savedState.recordings) this.recordings = savedState.recordings;

                // Initialize Audio Settings from Save
                if (savedState.audioSettings) {
                    this.audioSettings = { ...DEFAULT_AUDIO_SETTINGS, ...savedState.audioSettings };
                }
            }

            // Sync Remote Server Preference from Global Settings
            if (settingsStore.isWebServerEnabled) {
                console.log('[WebRemote] Auto-starting web server based on global settings');
                this.remoteServerStatus.port = settingsStore.remoteServerPort;
                this.setRemoteServerState(true);
            }

            // 4. Sync Settings to Synth engine
            // Apply volume (including ODF gain)
            this.setGlobalVolume(this.globalVolume);

            synth.setReleaseMode(this.audioSettings.releaseMode);
            synth.setLoadingMode(this.audioSettings.loadingMode);
            if (this.audioSettings.releaseMode === 'convolution') {
                synth.configureReverb(this.audioSettings.reverbLength, this.audioSettings.reverbMix);
            }

            // 5. Start MIDI
            this.initMIDI();

            // 6. Trigger Preload (if any)
            if (this.audioSettings.loadingMode !== 'none') {
                await this.triggerPreload(this.audioSettings.loadingMode);
            }

            // 7. Initialize Export Store polling
            const exportStore = useExportStore();
            exportStore.fetchDrives();
            if (this.drivePollInterval) clearInterval(this.drivePollInterval);
            this.drivePollInterval = setInterval(() => exportStore.fetchDrives(), 5000);

            await this.refreshRemoteStatus();

            // Restore Active Combination to Synth
            this.currentCombination.forEach(stopId => synth.markStopSelected(stopId));

            this.syncRemoteState();
            this.isLoadingOrgan = false;
        },

        async stopOrgan() {
            console.log('[OrganStore] Stopping organ (killing workers)...');
            this.stopMIDI();
            await synth.unload();

            // Clear data references to allow GC
            this.organData = null;
            this.banks = [];
            this.currentCombination = [];
            this.stopVolumes = {};
            this.virtualStops = [];

            if (this.drivePollInterval) {
                clearInterval(this.drivePollInterval);
                this.drivePollInterval = null;
            }

            if (this.sampleProgressPollingInterval) {
                clearInterval(this.sampleProgressPollingInterval);
                this.sampleProgressPollingInterval = null;
            }
        },

        toggleStop(stopId: string) {
            if (!this.organData) return;
            const index = this.currentCombination.indexOf(stopId);
            if (index === -1) {
                this.currentCombination = [...this.currentCombination, stopId];
                synth.markStopSelected(stopId);
                this.activeMidiNotes.forEach(note => {
                    this.triggerPipe(note, stopId, true, 64);
                });
            } else {
                this.currentCombination = this.currentCombination.filter(id => id !== stopId);
                synth.markStopDeselected(stopId);
                this.activeMidiNotes.forEach(note => {
                    this.triggerPipe(note, stopId, false, 0);
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
                    this.triggerPipe(note, stopId, false, 0);
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

        toggleRankDisabled(rankId: string) {
            const idx = this.audioSettings.disabledRanks.indexOf(rankId);
            if (idx === -1) {
                this.audioSettings.disabledRanks.push(rankId);
            } else {
                this.audioSettings.disabledRanks.splice(idx, 1);
            }
            this.saveInternalState();
        },


        async setReleaseMode(mode: 'authentic' | 'convolution' | 'none') {
            this.audioSettings.releaseMode = mode;
            synth.setReleaseMode(mode);
            this.saveInternalState();
        },

        async setLoadingMode(mode: 'none' | 'quick' | 'full') {
            this.audioSettings.loadingMode = mode;
            synth.setLoadingMode(mode);
            this.saveInternalState();
        },

        async setReverbSettings(length: number, mix: number) {
            this.audioSettings.reverbMix = mix;
            synth.configureReverb(length, mix);
            this.saveInternalState();
        },

        setupSampleLoadListener() {
            if (this.sampleLoadListener) this.sampleLoadListener();
            this.sampleLoadListener = window.myApi.onSampleLoadedBatch((_event, count) => {
                if (this.pendingLoadCount > 0) {
                    this.pendingLoadCount = Math.max(0, this.pendingLoadCount - count);
                    const loadedCount = this.totalPreloadCount - this.pendingLoadCount;

                    if (this.totalPreloadCount > 0) {
                        this.extractionProgress = loadedCount / this.totalPreloadCount;
                    }

                    if (this.pendingLoadCount === 0) {
                        this.isLoadingOrgan = false;
                        this.renderStatus = 'Loading complete.';
                        console.log('[OrganStore] All samples loaded (batched).');
                        setTimeout(() => {
                            if (this.renderStatus === 'Loading complete.') this.renderStatus = '';
                        }, 2000);
                    }
                }
            });
        },

        async triggerPreload(mode: 'quick' | 'full') {
            if (!this.organData) return;
            const stops = this.organData.stops; // All stops
            const stopIds = Object.keys(stops);

            console.log(`[OrganStore] Triggering ${mode} preload for all ${stopIds.length} stops...`);

            this.isLoadingOrgan = true; // Use this to show spinner/progress
            this.renderStatus = `Preloading samples(${mode})...`;
            this.extractionProgress = 0;

            // 1. Calculate Total Pipes first
            let totalPipes = 0;
            const pipesToLoad: { stopId: string, pipe: any, rankId: string, isRelease: boolean }[] = [];

            stopIds.forEach(stopId => {
                const stop = stops[stopId];
                if (!stop) return;
                stop.rankIds.forEach((rankId: string) => {
                    if (this.organData && this.organData.ranks[rankId]) {
                        const rank = this.organData.ranks[rankId];
                        if (this.audioSettings.disabledRanks.includes(rankId)) return;
                        Object.values(rank.pipes).forEach((pipe: any) => {
                            // Main Pipe
                            pipesToLoad.push({ stopId, pipe, rankId, isRelease: false });

                            // Release Pipe (if Authentic and exists)
                            if (this.audioSettings.releaseMode === 'authentic' && pipe.releasePath) {
                                pipesToLoad.push({ stopId, pipe, rankId, isRelease: true });
                            }
                        });
                    }
                });
            });

            this.totalPreloadCount = pipesToLoad.length;
            this.pendingLoadCount = this.totalPreloadCount;
            console.log(`[OrganStore] Expecting ${this.totalPreloadCount} samples.`);

            if (this.totalPreloadCount === 0) {
                this.isLoadingOrgan = false;
                return;
            }

            // Reset and Start Listening
            await (window.myApi as any).resetProgressBuffer();
            this.setupSampleLoadListener();

            // 2. Dispatch Loads
            const CHUNK_SIZE = 10; // Pipes per tick
            for (let i = 0; i < pipesToLoad.length; i += CHUNK_SIZE) {
                const chunk = pipesToLoad.slice(i, i + CHUNK_SIZE);
                chunk.forEach(item => {
                    const path = item.isRelease ? item.pipe.releasePath : item.pipe.wavPath;

                    if (mode === 'quick') {
                        // Quick mode handles main sample only?
                        // Actually if we want quick releases? 500ms release?
                        // Let's assume loading main 1s is enough for quick.
                        // But if we pushed it to list, we should load it.
                        // Partial load release too.
                        synth.loadSample(item.stopId, path, 'partial', { maxDuration: 1.0 });
                    } else {
                        const crop = this.audioSettings.releaseMode !== 'authentic';
                        // If it is a release sample, never crop loop (it has no loop).
                        // If it is main sample, crop if not authentic.
                        // Wait, if authentic mode is ON, we load main (full) + release (full/partial?).
                        // If authentic mode is OFF (Convolution), we load main (cropped).

                        const shouldCrop = !item.isRelease && crop;
                        synth.loadSample(item.stopId, path, 'full', { cropToLoop: shouldCrop });
                    }
                });

                await new Promise(r => setTimeout(r, 10)); // Yield to UI
            }

            console.log('[OrganStore] Preload requests sent. Waiting for workers...');
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

                this.initWorkerStats();
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
            const toggleStopCleanup = window.myApi.onRemoteToggleStop((event: any, stopId: string) => {
                this.toggleStop(stopId);
            });
            const clearCleanup = window.myApi.onRemoteClearCombination(() => {
                this.clearCombination();
            });
            const loadBankCleanup = window.myApi.onRemoteLoadBank((_: any, data: any) => {
                this.loadBank(data.index);
            });
            const saveToBankCleanup = window.myApi.onRemoteSaveToBank((_: any, data: any) => {
                this.saveToBank(data.index);
            });
            const addBankCleanup = window.myApi.onRemoteAddBank((_: any, data: any) => {
                this.addBank();
            });
            const deleteBankCleanup = window.myApi.onRemoteDeleteBank((_: any, data: any) => {
                this.deleteBank(data.index);
            });
            const moveBankCleanup = window.myApi.onRemoteMoveBank((_: any, data: any) => {
                this.moveBank(data.fromIndex, data.toIndex);
            });
            const deleteRecordingCleanup = window.myApi.onRemoteDeleteRecording((_: any, data: any) => {
                this.deleteRecording(data.id);
            });
            const setStopVolumeCleanup = window.myApi.onRemoteSetStopVolume((_: any, data: any) => {
                this.setStopVolume(data.stopId, data.volume);
            });
            const toggleRecordingCleanup = window.myApi.onRemoteToggleRecording((_: any, data: any) => {
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording();
                }
            });
            const playRecordingCleanup = window.myApi.onRemotePlayRecording((_: any, data: any) => {
                this.playRecording(data.id);
            });
            const stopPlaybackCleanup = window.myApi.onRemoteStopPlayback(() => {
                this.stopPlayback();
            });
            const serverErrorCleanup = window.myApi.onRemoteServerError((message: string) => {
                console.error('[OrganStore] Remote Server Error:', message);
                this.remoteServerStatus.running = false;
                const settingsStore = useSettingsStore();
                settingsStore.saveSettings({ isWebServerEnabled: false });
            });

            this.remoteSyncCleanup = () => {
                toggleStopCleanup();
                clearCleanup();
                loadBankCleanup();
                saveToBankCleanup();
                addBankCleanup();
                deleteBankCleanup();
                moveBankCleanup();
                deleteRecordingCleanup();
                setStopVolumeCleanup();
                toggleRecordingCleanup();
                playRecordingCleanup();
                stopPlaybackCleanup();
                serverErrorCleanup();
            };
            this.refreshRemoteStatus();
        },

        initWorkerStats() {
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

            // Persist to Global Settings
            const settingsStore = useSettingsStore();
            await settingsStore.saveSettings({
                isWebServerEnabled: running,
                remoteServerPort: this.remoteServerStatus.port
            });

            // We don't saveInternalState here anymore as it is a global setting
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
                        activeScreenIndex: 0
                    },
                    activatedStops: [...this.currentCombination],
                    // Additional State for Remote App
                    banks: this.banks,
                    recordings: this.recordings,
                    isRecording: this.isRecording,
                    stopVolumes: this.stopVolumes,
                    isPlaying: this.isPlaying,
                    playbackRecordingId: this.playbackRecordingId
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
                this.midiAccess.inputs.forEach((input: any) => {
                    console.log(`[MIDI] Removing listener from input: ${input.name} `);
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
            console.log(`[MIDI] Event: Status = ${status}, Note = ${note}, Velocity = ${velocity}, Type = ${type} `);

            const isNoteOn = (type === 144 && velocity > 0);
            const isNoteOff = (type === 128 || (type === 144 && velocity === 0));

            if (isNoteOn) {
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
                    this.currentCombination.forEach((stopId) => {
                        this.triggerPipe(note, stopId, true, velocity);
                    });
                }
            } else if (isNoteOff) {
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
                        this.triggerPipe(note, stopId, false, 0);
                    });
                }
            }
        },

        async triggerPipe(note: number, stopId: string, isOn: boolean, velocity: number) {
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

            const adjustedNote = note + noteOffset;

            if (!isOn) {
                synth.noteOff(adjustedNote, stopId);
                return;
            }

            const stop = this.organData.stops[actualStopId];
            if (!stop) return;

            // Fire all ranks in parallel
            stop.rankIds.forEach(async (rankId: string) => {
                const data = this.organData;
                if (!data) return;
                const rank = data.ranks[rankId];
                if (rank) {
                    const pipe = rank.pipes[adjustedNote];
                    if (pipe) {
                        const manual = data.manuals.find(m => String(m.id) === String(stop.manualId));
                        const isPedal = manual?.name.toLowerCase().includes('pedal') || false;

                        // Combined Gain (dB)
                        // Global Gain + Manual Gain + Stop Gain + Pipe Gain (includes Rank/WC)
                        const combinedGain = (data.globalGain || 0) +
                            (manual?.gain || 0) +
                            (stop.gain || 0) +
                            (pipe.gain || 0);

                        const activeTremulants = this.currentCombination
                            .filter(id => id.startsWith('TREM_'))
                            .map(id => {
                                const tremId = id.replace('TREM_', '');
                                // DEEP CLONE to avoid Proxy/Cloning error in Worker
                                return JSON.parse(JSON.stringify(data.tremulants[tremId]));
                            })
                            .filter(trem => trem && (!trem.manualId || String(trem.manualId) === String(manual?.id)));

                        // CHECK IF RANK IS ENABLED
                        if (this.audioSettings.disabledRanks.includes(rankId)) {
                            return;
                        }

                        // Calculate total delay
                        const totalDelay = (pipe.trackerDelay || 0) + (vs?.delay || 0);

                        synth.noteOn(
                            adjustedNote,
                            stopId,
                            pipe.wavPath,
                            pipe.releasePath,
                            this.stopVolumes[stopId] || 100,
                            combinedGain,
                            pipe.tuning || 0,
                            (pipe.harmonicNumber || 1) * harmonicMultiplier,
                            isPedal,
                            manual?.id,
                            activeTremulants,
                            pitchShift,
                            totalDelay
                        );
                    }
                }
            });
        },

        setStopVolume(stopId: string, volume: number) {
            this.stopVolumes[stopId] = volume;
        },

        async renderAll() {
            const exportStore = useExportStore();
            await exportStore.renderAll();
        },

        cancelRendering() {
            // Moved to Export Store, but currentCombination might still be needed there?
            // For now, removing from here as requested.
        },

        addBank() {
            if (this.banks.length >= 32) return false;
            const newBank: Bank = {
                id: crypto.randomUUID(),
                name: `Bank ${this.banks.length + 1} `,
                combination: [...this.currentCombination],
                stopVolumes: { ...this.stopVolumes }
            };
            this.banks.push(newBank);
            this.syncRemoteState();
            this.saveInternalState();
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
                    this.activeMidiNotes.forEach(note => this.triggerPipe(note, id, false, 0));
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
                    this.activeMidiNotes.forEach(note => this.triggerPipe(note, id, true, 64));
                }
                if (this.isRecording) {
                    this.currentRecordingEvents.push({
                        timestamp: performance.now() - this.recordingStartTime,
                        type: 'stopOn',
                        stopId: id
                    });
                }
            });

            if (this.isRecording) {
                this.currentRecordingEvents.push({
                    timestamp: performance.now() - this.recordingStartTime,
                    type: 'bankChange',
                    bankIndex: index
                });
            }

            this.syncRemoteState();
            this.saveInternalState();
        },

        deleteBank(index: number) {
            this.banks.splice(index, 1);
            this.saveInternalState();
            this.syncRemoteState();
        },

        renameBank(index: number, newName: string) {
            if (this.banks[index]) {
                this.banks[index].name = newName;
                this.saveInternalState();
                this.syncRemoteState();
            }
        },

        moveBank(fromIndex: number, toIndex: number) {
            if (toIndex < 0 || toIndex >= this.banks.length) return;
            const item = this.banks.splice(fromIndex, 1)[0];
            if (item) {
                this.banks.splice(toIndex, 0, item);
                this.saveInternalState();
                this.syncRemoteState();
            }
        },

        addVirtualStop(stop: VirtualStop) {
            this.virtualStops.push(stop);
            this.saveInternalState();
        },

        updateVirtualStop(updatedStop: VirtualStop) {
            const index = this.virtualStops.findIndex(v => v.id === updatedStop.id);
            if (index > -1) {
                this.virtualStops.splice(index, 1, { ...updatedStop });
                this.saveInternalState();
            }
        },

        deleteVirtualStop(id: string) {
            this.virtualStops = this.virtualStops.filter(v => v.id !== id);
            this.currentCombination = this.currentCombination.filter(x => x !== id);
            this.banks.forEach(bank => {
                bank.combination = bank.combination.filter(x => x !== id);
            });
            this.saveInternalState();
        },

        saveToBank(bankNumber: number) {
            if (this.banks[bankNumber]) {
                this.banks[bankNumber].combination = [...this.currentCombination];
                this.banks[bankNumber].stopVolumes = { ...this.stopVolumes };
                this.saveInternalState();
                this.syncRemoteState();
            }
        },

        async saveInternalState() {
            if (!this.organData || !this.organData.sourcePath) return;
            const state = JSON.parse(JSON.stringify({
                banks: this.banks,
                stopVolumes: this.stopVolumes,
                virtualStops: this.virtualStops,
                recordings: this.recordings,
                audioSettings: this.audioSettings,
                outputDir: useExportStore().outputDir
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
            this.syncRemoteState();
        },

        stopRecording() {
            if (!this.isRecording) return;
            this.isRecording = false;

            if (this.currentRecordingEvents.length === 0) return;

            const duration = performance.now() - this.recordingStartTime;
            const newRecording: RecordingSession = {
                id: crypto.randomUUID(),
                name: `Recording ${this.recordings.length + 1} `,
                date: Date.now(),
                duration: duration,
                events: [...this.currentRecordingEvents]
            };

            this.recordings.unshift(newRecording);
            this.saveInternalState();
            this.syncRemoteState();
        },

        deleteRecording(id: string) {
            this.recordings = this.recordings.filter(r => r.id !== id);
            this.saveInternalState();
            this.syncRemoteState();
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
                virtualStops: this.virtualStops
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.organData?.name || 'organ'} _config.json`;
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
                reader.onload = async (re: any) => {
                    try {
                        const content = JSON.parse(re.target.result);
                        if (content.banks) this.banks = content.banks;
                        if (content.stopVolumes) this.stopVolumes = content.stopVolumes;
                        if (content.currentCombination) {
                            this.currentCombination = content.currentCombination;
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

        async exportRecordingToMIDI(recordingId: string) {
            const recording = this.recordings.find(r => r.id === recordingId);
            if (!recording) return;

            const track = new MidiWriter.Track();
            track.setTempo(120); // Default tempo for timestamp mapping
            // midi-writer-js uses ticks. Default PPQ is 128.
            // 120 BPM = 2 beats per second = 256 ticks per second.
            // tick = (ms / 1000) * (BPM / 60) * PPQ
            const msToTicks = (ms: number) => Math.round((ms / 1000) * (120 / 60) * 128);

            // Filter out events that occurred before the first note (if any) to avoid long leading silence
            const firstNote = recording.events.find(e => e.type === 'noteOn');
            const startTime = firstNote ? firstNote.timestamp : 0;

            // Group noteOn/noteOff into midi-writer NoteEvents
            const activeNotes = new Map<number, { start: number, velocity: number }>();

            recording.events.sort((a, b) => a.timestamp - b.timestamp).forEach(event => {
                const tick = msToTicks(Math.max(0, event.timestamp - startTime));

                if (event.type === 'noteOn' && event.note !== undefined) {
                    activeNotes.set(event.note, { start: tick, velocity: event.velocity || 64 });
                } else if (event.type === 'noteOff' && event.note !== undefined) {
                    const noteInfo = activeNotes.get(event.note);
                    if (noteInfo) {
                        track.addEvent(new MidiWriter.NoteEvent({
                            pitch: [event.note],
                            duration: `T${tick - noteInfo.start}`,
                            startTick: noteInfo.start,
                            velocity: noteInfo.velocity
                        }));
                        activeNotes.delete(event.note);
                    }
                } else if (event.type === 'stopOn' && event.stopId) {
                    track.addEvent(new MidiWriter.TextEvent({ text: `TCO:stopOn:${event.stopId}` }));
                    (track.events[track.events.length - 1] as any).tick = tick;
                } else if (event.type === 'stopOff' && event.stopId) {
                    track.addEvent(new MidiWriter.TextEvent({ text: `TCO:stopOff:${event.stopId}` }));
                    (track.events[track.events.length - 1] as any).tick = tick;
                } else if (event.type === 'bankChange' && event.bankIndex !== undefined) {
                    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: event.bankIndex + 1 }));
                    (track.events[track.events.length - 1] as any).tick = tick;
                }
            });

            // Handle notes still held at the end
            const lastTick = msToTicks(recording.duration - startTime);
            activeNotes.forEach((info, note) => {
                track.addEvent(new MidiWriter.NoteEvent({
                    pitch: [note],
                    duration: `T${lastTick - info.start}`,
                    startTick: info.start,
                    velocity: info.velocity
                }));
            });

            const writer = new MidiWriter.Writer(track);
            const uint8 = writer.buildFile();
            // Use slice() on the Uint8Array to ensure we get a clean ArrayBuffer copy (not SharedArrayBuffer)
            const buffer = uint8.slice().buffer as ArrayBuffer;
            await window.myApi.saveMidiFile(buffer, `${recording.name}.mid`);
        },

        async importRecordingFromMIDI() {
            const result = await window.myApi.openMidiFile();
            if ('canceled' in result || 'error' in result) return;

            try {
                const parsed = midiFile.parseMidi(new Uint8Array(result.buffer as any));
                const ppq = parsed.header.ticksPerBeat || 128;
                let tempo = 500000; // Default 120 BPM (microseconds per beat)

                const events: TimelineEvent[] = [];
                let maxTimestamp = 0;

                parsed.tracks.forEach(track => {
                    let currentTick = 0;
                    track.forEach(msg => {
                        currentTick += msg.deltaTime;
                        // timestamp (ms) = tick * (tempo / 1000) / ppq
                        const timestamp = (currentTick * (tempo / 1000)) / ppq;

                        if (msg.type === 'setTempo') {
                            tempo = msg.microsecondsPerBeat;
                        } else if (msg.type === 'noteOn') {
                            events.push({
                                timestamp,
                                type: msg.velocity > 0 ? 'noteOn' : 'noteOff',
                                note: msg.noteNumber,
                                velocity: msg.velocity
                            });
                        } else if (msg.type === 'noteOff') {
                            events.push({
                                timestamp,
                                type: 'noteOff',
                                note: msg.noteNumber,
                                velocity: 0
                            });
                        } else if (msg.type === 'programChange') {
                            events.push({
                                timestamp,
                                type: 'bankChange',
                                bankIndex: msg.programNumber
                            });
                        } else if (msg.type === 'text') {
                            if (msg.text.startsWith('TCO:stopOn:')) {
                                events.push({
                                    timestamp,
                                    type: 'stopOn',
                                    stopId: msg.text.replace('TCO:stopOn:', '')
                                });
                            } else if (msg.text.startsWith('TCO:stopOff:')) {
                                events.push({
                                    timestamp,
                                    type: 'stopOff',
                                    stopId: msg.text.replace('TCO:stopOff:', '')
                                });
                            }
                        }
                        maxTimestamp = Math.max(maxTimestamp, timestamp);
                    });
                });

                const newRecording: RecordingSession = {
                    id: crypto.randomUUID(),
                    name: result.filename.replace(/\.[^/.]+$/, ""),
                    date: Date.now(),
                    duration: maxTimestamp,
                    events: events.sort((a, b) => a.timestamp - b.timestamp)
                };

                this.recordings.unshift(newRecording);
                this.saveInternalState();
                this.syncRemoteState();
            } catch (err) {
                console.error('Failed to parse MIDI file', err);
            }
        },

        async playRecording(recordingId: string) {
            if (this.isPlaying) this.stopPlayback();

            const recording = this.recordings.find(r => r.id === recordingId);
            if (!recording || recording.events.length === 0) return;

            this.isPlaying = true;
            this.playbackRecordingId = recordingId;
            this.playbackStartTime = performance.now();
            this.playbackEventIndex = 0;
            this.syncRemoteState();

            const tick = () => {
                if (!this.isPlaying || this.playbackRecordingId !== recordingId) return;

                const now = performance.now();
                const elapsed = now - this.playbackStartTime;

                while (this.playbackEventIndex < recording.events.length) {
                    const event = recording.events[this.playbackEventIndex];
                    if (!event || event.timestamp > elapsed) break;

                    this.dispatchPlaybackEvent(event);
                    this.playbackEventIndex++;
                }

                if (this.playbackEventIndex >= recording.events.length) {
                    this.stopPlayback();
                } else {
                    this.playbackTimer = requestAnimationFrame(tick);
                }
            };

            this.playbackTimer = requestAnimationFrame(tick);
        },

        dispatchPlaybackEvent(event: TimelineEvent) {
            switch (event.type) {
                case 'noteOn':
                    if (event.note !== undefined && this.isSynthEnabled) {
                        this.activeMidiNotes.add(event.note);
                        this.currentCombination.forEach(stopId => this.triggerPipe(event.note!, stopId, true, (event as any).velocity || 64));
                    }
                    break;
                case 'noteOff':
                    if (event.note !== undefined && this.isSynthEnabled) {
                        this.activeMidiNotes.delete(event.note);
                        this.currentCombination.forEach(stopId => this.triggerPipe(event.note!, stopId, false, 0));
                    }
                    break;
                case 'stopOn':
                    if (event.stopId && !this.currentCombination.includes(event.stopId)) {
                        this.toggleStop(event.stopId);
                    }
                    break;
                case 'stopOff':
                    if (event.stopId && this.currentCombination.includes(event.stopId)) {
                        this.toggleStop(event.stopId);
                    }
                    break;
                case 'bankChange':
                    if (event.bankIndex !== undefined) {
                        this.loadBank(event.bankIndex);
                    }
                    break;
            }
        },

        stopPlayback() {
            this.isPlaying = false;
            if (this.playbackTimer) {
                cancelAnimationFrame(this.playbackTimer);
                this.playbackTimer = null;
            }
            this.playbackRecordingId = null;
            this.syncRemoteState();

            // Kill all sound
            if (this.isSynthEnabled) {
                this.activeMidiNotes.forEach(note => {
                    this.currentCombination.forEach(stopId => this.triggerPipe(note, stopId, false, 0));
                });
                this.activeMidiNotes.clear();
            }
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
        }
    }
});

