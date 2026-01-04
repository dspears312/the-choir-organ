import { defineStore } from 'pinia';
import { useOrganStore } from './organ';

export const useExportStore = defineStore('export', {
    state: () => ({
        isRendering: false,
        outputDir: '',
        renderProgress: 0,
        renderStatus: '',
        isOutputRemovable: false,
        availableDrives: [] as any[],
        drivePollInterval: null as any,
        suppressDiskWarning: false,

        // Recording Rendering
        selectedRecording: null as any,
        showRenderOptions: false,
        renderMode: 'tsunami' as 'tsunami' | 'tails'
    }),

    actions: {
        async setOutputDir() {
            const dir = await (window as any).myApi.selectFolder();
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
            const info = await (window as any).myApi.getDiskInfo(this.outputDir);
            this.isOutputRemovable = !!(info && info.isRemovable);
        },

        async fetchDrives() {
            const organStore = useOrganStore();
            const drives = await (window as any).myApi.listRemovableDrives();
            this.availableDrives = drives;

            // Auto-select drive if nothing selected
            if (!this.outputDir && drives.length > 0) {
                const target = drives.find((d: any) => d.volumeName === organStore.targetVolumeLabel) ||
                    drives.find((d: any) => d.volumeName === 'TCO');
                if (target) {
                    this.outputDir = target.mountPoint;
                    this.isOutputRemovable = true;
                }
            }
        },

        async checkOutputPath() {
            if (!this.outputDir) return { type: 'none' };
            const info = await (window as any).myApi.getDiskInfo(this.outputDir);
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
            const organStore = useOrganStore();
            this.isRendering = true;
            this.renderStatus = 'Formatting volume...';

            const label = organStore.targetVolumeLabel;

            try {
                const result = await (window as any).myApi.formatVolume(this.outputDir, label);
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
            (window as any).myApi.cancelRendering();
            this.renderStatus = 'Cancelling...';
        },

        async renderAll() {
            const organStore = useOrganStore();
            if (!organStore.organData || organStore.banks.length === 0) return;
            this.isRendering = true;
            this.renderStatus = 'Starting batch render...';
            try {
                for (let i = 0; i < organStore.banks.length; i++) {
                    this.renderStatus = `Rendering Bank ${i + 1} / ${organStore.banks.length}...`;
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
            const organStore = useOrganStore();
            const bank = organStore.banks[bankNumber];
            if (!bank || !organStore.organData) return;

            this.isRendering = true;
            this.renderProgress = 0;

            const progressListener = (_event: any, progress: number) => {
                this.renderProgress = progress / 100;
            };
            (window as any).myApi.onRenderProgress(progressListener);

            try {
                const cleanStops: any = {};
                Object.keys(organStore.organData.stops).forEach(id => {
                    const s = organStore.organData.stops[id];
                    cleanStops[id] = {
                        id: s.id,
                        name: s.name,
                        rankIds: [...s.rankIds],
                        manualId: s.manualId,
                        volume: bank.stopVolumes[id] ?? organStore.stopVolumes[id] ?? 100,
                        gain: s.gain || 0
                    };
                });

                organStore.virtualStops.forEach(vs => {
                    const originalStop = organStore.organData.stops[vs.originalStopId];
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
                Object.keys(organStore.organData.ranks).forEach(id => {
                    const r = organStore.organData.ranks[id];
                    cleanRanks[id] = {
                        name: r.name,
                        gain: r.gain || 0,
                        pipes: r.pipes.map((p: any) => ({ ...p }))
                    };
                });

                const cleanManuals = organStore.organData.manuals.map((m: any) => ({
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
                        name: organStore.organData.name,
                        globalGain: organStore.organData.globalGain ?? 0,
                        stops: cleanStops,
                        ranks: cleanRanks,
                        manuals: cleanManuals,
                        tremulants: organStore.organData.tremulants || {},
                        basePath: organStore.organData.basePath
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

        async renderPerformance(recording: any, organData: any, useTails: boolean) {
            this.isRendering = true;
            this.renderProgress = 0;
            this.renderStatus = 'Initializing performance render...';

            const progressListener = (_event: any, progress: number) => {
                this.renderProgress = progress / 100;
            };
            (window as any).myApi.onRenderProgress(progressListener);

            try {
                // Strip Proxies
                const cleanRecording = JSON.parse(JSON.stringify(recording));
                const cleanOrganData = JSON.parse(JSON.stringify(organData));

                await (window as any).myApi.renderPerformance(cleanRecording, cleanOrganData, useTails);
                this.renderStatus = 'Performance rendered successfully!';
            } catch (e: any) {
                console.error('Performance render failed:', e);
                this.renderStatus = `Render failed: ${e.message}`;
                throw e;
            } finally {
                this.isRendering = false;
                setTimeout(() => {
                    this.renderProgress = 0;
                    this.renderStatus = '';
                }, 2000);
            }
        }
    }
});
