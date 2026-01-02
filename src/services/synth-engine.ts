export interface Voice {
    note: number;
    stopId: string;
    pipePath: string;
    source: AudioBufferSourceNode;
    gain: GainNode;
    releasePath?: string | undefined;
    volume: number;
    gainDb: number;
    tuning: number; // cents from ODF (usually ignored/broken)
    wavTuning: number; // cents from WAV metadata
    harmonicNumber: number;
    isPedal: boolean;
    manualId?: string | undefined;
    basePlaybackRate?: number;
    pitchOffsetCents: number; // For virtual stop shift
    renderingNote: number;    // For virtual stop transposition
}

export interface WavMetadata {
    sampleRate: number;
    unityNote?: number;
    pitchFraction?: number;
    cues: Array<{ id: number, position: number }>;
    loops: Array<{ start: number, end: number }>;
}

export class SynthEngine {
    private context: AudioContext;
    private buffers: Record<string, AudioBuffer> = {};
    private metadata: Record<string, WavMetadata> = {};
    private loadingTasks: Record<string, Promise<void>> = {};
    private activeVoices: Voice[] = [];
    private requestedNotes: Set<string> = new Set(); // Tracks held keys (note-stopId key)
    private masterGain: GainNode;
    public analyser: AnalyserNode;
    private isTsunamiMode = false;
    private useReleaseSamples = false;
    private globalGainDb = 0;

    constructor() {
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.context.createGain();

        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.8;

        this.updateMasterGain();

        // Routing: MasterGain -> Analyser -> Destination
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.context.destination);
    }

    private updateMasterGain() {
        const linear = Math.pow(10, this.globalGainDb / 20) * 0.5;
        this.masterGain.gain.setTargetAtTime(linear, this.context.currentTime, 0.05);
    }

    setGlobalGain(db: number) {
        this.globalGainDb = db;
        this.updateMasterGain();
    }

    setTsunamiMode(enabled: boolean) {
        this.isTsunamiMode = enabled;
        this.updateMasterGain();
    }

    setUseReleaseSamples(enabled: boolean) {
        this.useReleaseSamples = enabled;
    }

    async loadSample(stopId: string, pipePath: string): Promise<void> {
        if (!pipePath) return;
        const key = `${stopId}-${pipePath}`;
        if (this.buffers[key]) return;
        if (this.loadingTasks[key]) return this.loadingTasks[key];

        this.loadingTasks[key] = (async () => {
            try {
                const meta = await (window as any).myApi.getWavInfo(pipePath);
                if (meta) {
                    this.metadata[key] = meta;
                }
                const arrayBuffer = await (window as any).myApi.readFileAsArrayBuffer(pipePath);
                const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
                this.buffers[key] = audioBuffer;
            } catch (e) {
                console.error(`Failed to load sample for synth: ${pipePath}`, e);
            } finally {
                delete this.loadingTasks[key];
            }
        })();

        return this.loadingTasks[key];
    }

    async noteOn(
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
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }

        const requestKey = `${note}-${stopId}`;
        const bufferKey = `${stopId}-${pipePath}`;

        this.requestedNotes.add(requestKey);

        if (!this.buffers[bufferKey]) {
            if (this.loadingTasks[bufferKey]) {
                await this.loadingTasks[bufferKey];
            } else {
                await this.loadSample(stopId, pipePath);
            }
        }

        if (!this.requestedNotes.has(requestKey)) {
            return;
        }

        const buffer = this.buffers[bufferKey];
        const meta = this.metadata[bufferKey];

        if (!buffer) return;

        const source = this.context.createBufferSource();
        source.buffer = buffer;

        if (meta && meta.loops && meta.loops.length > 0) {
            const loop = meta.loops[0];
            if (loop) {
                const sr = buffer.sampleRate || 44100;
                source.loop = true;
                source.loopStart = (loop.start || 0) / sr;
                source.loopEnd = (loop.end || buffer.length - 1) / sr;
            }
        }

        let wavTuning = 0;
        const pitchRefNote = renderingNote !== undefined ? renderingNote : note;
        if (meta && meta.unityNote !== undefined && !isNaN(meta.unityNote) && meta.unityNote > 0 && meta.unityNote < 128) {
            wavTuning = (pitchRefNote - meta.unityNote) * 100;
            if (meta.pitchFraction !== undefined && !isNaN(meta.pitchFraction) && meta.pitchFraction !== 0) {
                const fractionCents = (meta.pitchFraction / 4294967296) * 100;
                wavTuning -= fractionCents;
            }
        }

        const harmonicCents = 1200 * Math.log2(harmonicNumber / 8);
        // DO NOT USE pipe tuning from ODF. It is broken and will cause heinous audio errors.
        // We only use the virtual stop pitchOffsetCents.
        const totalCents = wavTuning + harmonicCents + pitchOffsetCents;
        if (!isNaN(totalCents) && totalCents !== 0) {
            source.playbackRate.value = Math.pow(2, totalCents / 1200);
        }

        console.log(`[Synth] Note On: Note=${note}, Stop=${stopId}, Pipe=${pipePath}`);

        const gainNode = this.context.createGain();
        const linearGain = Math.pow(10, (gainDb || 0) / 20);

        let pedalScale = 1.0;
        if (isPedal) {
            pedalScale = Math.max(0, 1.0 - (note - 36) * (1.0 / 24));
        }

        const finalVolume = (volume / 100) * linearGain * pedalScale;
        gainNode.gain.value = finalVolume;

        source.connect(gainNode);
        gainNode.connect(this.masterGain);

        source.start(this.context.currentTime + (delay / 1000));

        const voice: Voice = {
            note,
            stopId,
            pipePath,
            source,
            gain: gainNode,
            releasePath,
            volume,
            gainDb,
            tuning,
            wavTuning,
            harmonicNumber,
            isPedal,
            manualId,
            basePlaybackRate: source.playbackRate.value,
            pitchOffsetCents,
            renderingNote: renderingNote ?? note
        };
        this.activeVoices.push(voice);

        // Apply Tremulants
        this.applyTremulantsToVoice(voice, activeTremulants);
    }

    private applyTremulantsToVoice(voice: Voice, activeTremulants: any[]) {
        activeTremulants.forEach(trem => {
            // Apply only if it belongs to this manual (or global)
            if (trem.manualId && String(trem.manualId) !== String(voice.manualId)) return;

            let ampDepth = trem.ampModDepth || 0;
            let pitchDepth = trem.pitchModDepth || 0;

            if (ampDepth === 0 && pitchDepth === 0) {
                ampDepth = 10;   // 10% volume modulation
                pitchDepth = 1.0; // 1% pitch modulation
            }

            const lfo = this.context.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = 1000 / (trem.period || 200);

            // Amplitude Modulation
            const lfoGain = this.context.createGain();
            const baseGain = (voice.volume / 100) * Math.pow(10, (voice.gainDb || 0) / 20);
            let pedalScale = 1.0;
            if (voice.isPedal) {
                pedalScale = Math.max(0, 1.0 - (voice.note - 36) * (1.0 / 24));
            }
            lfoGain.gain.value = baseGain * pedalScale * (ampDepth / 100);

            lfo.connect(lfoGain);
            lfoGain.connect(voice.gain.gain);

            // Frequency Modulation (Pitch)
            const gains = [lfoGain];
            if (pitchDepth > 0) {
                const lfoPitchGain = this.context.createGain();
                lfoPitchGain.gain.value = (voice.basePlaybackRate || 1.0) * (pitchDepth / 100);
                lfo.connect(lfoPitchGain);
                lfoPitchGain.connect(voice.source.playbackRate);
                gains.push(lfoPitchGain);
            }

            lfo.start();
            (voice.source as any).lfos = (voice.source as any).lfos || [];
            (voice.source as any).lfos.push({ lfo, gains });
        });
    }

    updateTremulants(allActiveTremulants: any[]) {
        this.activeVoices.forEach(voice => {
            // 1. Stop and disconnect existing LFOs
            if ((voice.source as any).lfos) {
                (voice.source as any).lfos.forEach((item: any) => {
                    try {
                        item.lfo.stop();
                        item.lfo.disconnect();
                        item.gains.forEach((g: any) => g.disconnect());
                    } catch (e) {
                        // ignore
                    }
                });
            }
            (voice.source as any).lfos = [];

            // 2. Re-apply current active ones
            this.applyTremulantsToVoice(voice, allActiveTremulants);
        });
    }

    noteOff(note: number, stopId: string) {
        console.log(`[Synth] Note Off: Note=${note}, Stop=${stopId}`);
        const requestKey = `${note}-${stopId}`;
        this.requestedNotes.delete(requestKey);

        const voicesToStop = this.activeVoices.filter(v => v.note === note && v.stopId === stopId);
        voicesToStop.forEach(v => {
            if (this.isTsunamiMode) {
                this.fadeVoice(v, 0.05);
            } else if (this.useReleaseSamples) {
                this.triggerRelease(v);
            } else {
                this.fadeVoice(v, 0.2);
            }
        });
    }

    private triggerRelease(voice: Voice) {
        let relPath = voice.releasePath;
        if (!relPath) {
            const meta = this.metadata[`${voice.stopId}-${voice.pipePath}`];
            if (meta && meta.cues && meta.cues.length > 0) {
                relPath = voice.pipePath;
            }
        }

        const now = this.context.currentTime;
        const crossfadeTime = 0.05;

        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + crossfadeTime);

        if (relPath) {
            const relKey = `${voice.stopId}-${relPath}`;
            const relBuffer = this.buffers[relKey];

            if (relBuffer) {
                const relSource = this.context.createBufferSource();
                relSource.buffer = relBuffer;

                const harmonicCents = 1200 * Math.log2(voice.harmonicNumber / 8);
                // Use stored virtual offsets for release too
                const totalCents = (voice.wavTuning || 0) + harmonicCents + (voice.pitchOffsetCents || 0);
                if (!isNaN(totalCents) && totalCents !== 0) {
                    relSource.playbackRate.value = Math.pow(2, totalCents / 1200);
                }

                const relGain = this.context.createGain();
                const linearGain = Math.pow(10, (voice.gainDb || 0) / 20);

                let pedalScale = 1.0;
                if (voice.isPedal) {
                    pedalScale = Math.max(0, 1.0 - (voice.note - 36) * (1.0 / 24));
                }

                const targetVolume = (voice.volume / 100) * linearGain * pedalScale;

                relGain.gain.setValueAtTime(0, now);
                relGain.gain.linearRampToValueAtTime(targetVolume, now + crossfadeTime);

                relSource.connect(relGain);
                relGain.connect(this.masterGain);

                relSource.start(now);

                relSource.onended = () => {
                    relSource.disconnect();
                    relGain.disconnect();
                };
            }
        }

        setTimeout(() => {
            this.stopVoice(voice);
        }, (crossfadeTime + 0.1) * 1000);
    }

    private fadeVoice(voice: Voice, fadeTime: number) {
        const now = this.context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + fadeTime);

        setTimeout(() => {
            this.stopVoice(voice);
        }, (fadeTime + 0.1) * 1000);
    }

    private stopVoice(voice: Voice) {
        try {
            if ((voice.source as any).lfos) {
                (voice.source as any).lfos.forEach((item: any) => {
                    try {
                        item.lfo.stop();
                        item.lfo.disconnect();
                        item.gains.forEach((g: any) => g.disconnect());
                    } catch (e) {
                        // ignore
                    }
                });
            }
            voice.source.stop();
            voice.source.disconnect();
            voice.gain.disconnect();
        } catch (e) {
            // Already stopped
        }
        const index = this.activeVoices.indexOf(voice);
        if (index > -1) {
            this.activeVoices.splice(index, 1);
        }
    }

    clearAll() {
        this.activeVoices.forEach(v => this.stopVoice(v));
        this.activeVoices = [];
        this.requestedNotes.clear();
    }

    unloadSamples() {
        this.clearAll();
        // Clear references to large audio buffers
        this.buffers = {};
        this.metadata = {};
        this.loadingTasks = {};
        console.log('[Synth] All samples unloaded from memory.');
    }


    close() {
        this.clearAll();
        if (this.context.state !== 'closed') {
            this.context.close();
        }
    }
}

export const synth = new SynthEngine();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        try {
            synth.close();
        } catch (e) {
            console.error('Failed to close synth on HMR', e);
        }
    });
}
