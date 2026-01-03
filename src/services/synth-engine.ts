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
    startTime: number;        // To sync partial -> full swap
}

export interface WavMetadata {
    sampleRate: number;
    unityNote?: number;
    pitchFraction?: number;
    cues: Array<{ id: number, position: number }>;
    loops: Array<{ start: number, end: number }>;
}

export interface SampleBuffer {
    partial: AudioBuffer | null;
    full: AudioBuffer | null;
    status: 'none' | 'partial' | 'full' | 'loading';
}

export class SynthEngine {
    private context: AudioContext;
    private buffers: Record<string, SampleBuffer> = {};
    private metadata: Record<string, WavMetadata> = {};
    private loadingTasks: Record<string, Promise<void>> = {};
    private unloadTimeouts: Record<string, NodeJS.Timeout> = {};
    private selectedStops: Set<string> = new Set();
    private activeVoices: Voice[] = [];
    private requestedNotes: Set<string> = new Set(); // Tracks held keys (note-stopId key)
    private lastActiveTremulants: any[] = [];
    private requestQueue: (() => void)[] = [];
    private activeRequests = 0;
    private maxConcurrency = 20;
    private masterGain: GainNode;
    private dryGain: GainNode;
    private reverbGain: GainNode;
    private convolver: ConvolverNode;
    public analyser: AnalyserNode;
    private isTsunamiMode = false;
    private useReleaseSamples = false;
    private releaseMode: 'authentic' | 'convolution' | 'none' = 'authentic';
    private globalGainDb = 0;
    private reverbImpulseParams = { length: 2.0, mix: 0.3 };

    constructor() {
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.context.createGain();

        // Reverb Chain
        this.convolver = this.context.createConvolver();
        this.dryGain = this.context.createGain();
        this.reverbGain = this.context.createGain();

        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.8;

        this.updateMasterGain();

        // Routing: 
        // Voices -> MasterGain
        // MasterGain -> DryGain -> Analyser
        // MasterGain -> Convolver -> ReverbGain -> Analyser

        this.masterGain.connect(this.dryGain);
        this.dryGain.connect(this.analyser);

        this.masterGain.connect(this.convolver);
        this.convolver.connect(this.reverbGain);
        this.reverbGain.connect(this.analyser);

        this.analyser.connect(this.context.destination);

        // Default to dry
        this.dryGain.gain.value = 1.0;
        this.reverbGain.gain.value = 0.0;
    }

    configureReverb(length: number, mix: number) {
        this.reverbImpulseParams = { length, mix };
        if (this.releaseMode === 'convolution') {
            this.generateImpulseResponse();
            this.updateReverbMix();
        }
    }

    setReleaseMode(mode: 'authentic' | 'convolution' | 'none') {
        this.releaseMode = mode;
        this.useReleaseSamples = mode === 'authentic';

        if (mode === 'convolution') {
            this.generateImpulseResponse();
            this.updateReverbMix();
        } else {
            // Disable reverb (Dry only)
            this.dryGain.gain.setTargetAtTime(1.0, this.context.currentTime, 0.05);
            this.reverbGain.gain.setTargetAtTime(0.0, this.context.currentTime, 0.05);
        }
    }

    private updateReverbMix() {
        if (this.releaseMode !== 'convolution') return;
        const mix = Math.min(Math.max(this.reverbImpulseParams.mix, 0), 1);
        // Equal power crossfade roughly
        const dry = Math.cos(mix * 0.5 * Math.PI);
        const wet = Math.sin(mix * 0.5 * Math.PI);

        this.dryGain.gain.setTargetAtTime(dry, this.context.currentTime, 0.05);
        this.reverbGain.gain.setTargetAtTime(wet, this.context.currentTime, 0.05);
    }

    private generateImpulseResponse() {
        const duration = this.reverbImpulseParams.length;
        const decay = 2.0;
        const rate = this.context.sampleRate;
        const length = rate * duration;
        const impulse = this.context.createBuffer(2, length, rate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            // Simple exponential decay noise
            const n = i / length;
            const env = Math.pow(1 - n, decay);
            left[i] = (Math.random() * 2 - 1) * env;
            right[i] = (Math.random() * 2 - 1) * env;
        }

        this.convolver.buffer = impulse;
    }

    private updateMasterGain() {
        const linear = Math.pow(10, this.globalGainDb / 20);
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



    markStopSelected(stopId: string) {
        this.selectedStops.add(stopId);
    }

    async loadSample(stopId: string, pipePath: string, type: 'partial' | 'full' = 'partial', params?: { maxDuration?: number, cropToLoop?: boolean }): Promise<void> {
        if (!pipePath) {
            console.warn('No pipe path provided for sample load');
            return;
        }
        const key = `${stopId}-${pipePath}`;

        if (!this.buffers[key]) {
            this.buffers[key] = { partial: null, full: null, status: 'none' };
        }

        const sample = this.buffers[key];
        if (type === 'full' && sample.status === 'full') {
            console.warn('Sample already loaded');
            return
        };
        if (type === 'partial' && (sample.status === 'partial' || sample.status === 'full')) {
            console.warn('Sample already loaded');
            return;
        };

        // Include params in task key to allow concurrent loading of different versions if needed (unlikely but safe)
        // actually standard 'full' should overwrite any special full load?
        // 'full' usually means "the version we want to play". whether it's 1s or real full depends on params.

        const taskKey = key + '-' + type;
        if (this.loadingTasks[taskKey]) return this.loadingTasks[taskKey];

        this.loadingTasks[taskKey] = (async () => {
            // ... concurrency wait ...
            // Wait for a slot in the global concurrency queue
            if (this.activeRequests >= this.maxConcurrency) {
                await new Promise<void>(resolve => {
                    if (type === 'partial') {
                        // High priority: Jump to front of the queue
                        this.requestQueue.unshift(resolve);
                    } else {
                        // Background: Standard queueing
                        this.requestQueue.push(resolve);
                    }
                });
            }
            this.activeRequests++;

            try {
                // ... cancel unloads ...
                // Cancel pending unload for this sample if we are loading it
                if (this.unloadTimeouts[key]) {
                    clearTimeout(this.unloadTimeouts[key]);
                    delete this.unloadTimeouts[key];
                }

                if (!this.metadata[key]) {
                    const meta = await (window as any).myApi.getWavInfo(pipePath);
                    if (meta) {
                        this.metadata[key] = meta;
                    }
                }

                // Use high-performance custom protocol
                let url = `organ-sample://host?path=${encodeURIComponent(pipePath)}&type=${type}`;
                if (params) {
                    if (params.maxDuration) url += `&maxDuration=${params.maxDuration}`;
                    if (params.cropToLoop) url += `&cropToLoop=${params.cropToLoop}`;
                }

                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

                if (type === 'partial') {
                    sample.partial = audioBuffer;
                    if (sample.status === 'none') {
                        sample.status = 'partial';
                    }
                } else {
                    sample.full = audioBuffer;
                    sample.status = 'full';
                }
            } catch (e) {
                console.error(`Failed to load sample for synth: ${pipePath} (${type})`, e);
            } finally {
                delete this.loadingTasks[taskKey];
                // Release slot and trigger next in queue
                this.activeRequests--;
                if (this.requestQueue.length > 0) {
                    const next = this.requestQueue.shift();
                    if (next) next();
                }
            }
        })();

        return this.loadingTasks[taskKey];
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

        // Cancel any pending unload timer for this specific buffer
        if (this.unloadTimeouts[bufferKey]) {
            clearTimeout(this.unloadTimeouts[bufferKey]);
            delete this.unloadTimeouts[bufferKey];
        }
        if (releasePath) {
            const relKey = `${stopId}-${releasePath}`;
            if (this.unloadTimeouts[relKey]) {
                clearTimeout(this.unloadTimeouts[relKey]);
                delete this.unloadTimeouts[relKey];
            }
        }

        this.requestedNotes.add(requestKey);

        const sample = this.buffers[bufferKey];
        if (!sample || sample.status === 'none') {
            await this.loadSample(stopId, pipePath, 'partial');
        }

        // Trigger full load in background if not already present/loading
        const currentSample = this.buffers[bufferKey];
        if (currentSample && currentSample.status !== 'full') {
            this.loadSample(stopId, pipePath, 'full');
            // Also trigger full load for release if it exists
            if (releasePath) {
                this.loadSample(stopId, releasePath, 'full');
            }
        }

        if (!this.requestedNotes.has(requestKey)) {
            return;
        }

        const buffer = currentSample?.full || currentSample?.partial;
        const meta = this.metadata[bufferKey];

        if (!buffer) return;

        const source = this.context.createBufferSource();
        source.buffer = buffer;

        if (meta && meta.loops && meta.loops.length > 0) {
            const loop = meta.loops[0];
            if (loop) {
                const sr = buffer.sampleRate || 44100;
                source.loop = true;
                // Clamp loop points to duration to prevent silence on partial buffers
                source.loopStart = Math.min((loop.start || 0) / sr, buffer.duration - 0.001);
                source.loopEnd = Math.min((loop.end || buffer.length - 1) / sr, buffer.duration);
                // Ensure loopStart is before loopEnd
                if (source.loopStart >= source.loopEnd) {
                    source.loopStart = 0;
                }
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
            renderingNote: renderingNote ?? note,
            startTime: this.context.currentTime
        };
        this.activeVoices.push(voice);

        // If we started with partial, trigger full load and swap when ready
        if (currentSample && currentSample.status !== 'full') {
            this.loadSample(stopId, pipePath, 'full').then(() => {
                this.swapVoiceToFull(voice);
            });
            if (releasePath) {
                this.loadSample(stopId, releasePath, 'full');
            }
        }

        // Apply Tremulants
        this.applyTremulantsToVoice(voice, activeTremulants);
    }

    private swapVoiceToFull(voice: Voice) {
        // Check if voice is still active and needs swapping
        if (!this.activeVoices.includes(voice)) return;
        const bufferKey = `${voice.stopId}-${voice.pipePath}`;
        const sample = this.buffers[bufferKey];
        if (!sample || !sample.full || voice.source.buffer === sample.full) return;

        console.log(`[Synth] Swapping voice ${voice.note} on stop ${voice.stopId} to full buffer...`);

        const now = this.context.currentTime;
        const crossfadeTime = 0.1;
        const playbackRate = voice.source.playbackRate.value;
        const elapsed = (now - voice.startTime);

        // Calculate offset (rough phase alignment)
        const offset = (elapsed * playbackRate) % voice.source.buffer!.duration;

        const newSource = this.context.createBufferSource();
        newSource.buffer = sample.full;
        newSource.playbackRate.value = playbackRate;
        newSource.loop = voice.source.loop;

        const meta = this.metadata[bufferKey];
        if (meta && meta.loops && meta.loops.length > 0) {
            const loop = meta.loops[0];
            const sr = sample.full.sampleRate;
            newSource.loopStart = (loop.start || 0) / sr;
            newSource.loopEnd = (loop.end || sample.full.length - 1) / sr;
        }

        const newGainNode = this.context.createGain();
        // Match current volume
        const currentTargetGain = (voice.volume / 100) * Math.pow(10, (voice.gainDb || 0) / 20);
        let pedalScale = 1.0;
        if (voice.isPedal) {
            pedalScale = Math.max(0, 1.0 - (voice.note - 36) * (1.0 / 24));
        }
        const finalVolume = currentTargetGain * pedalScale;

        newGainNode.gain.setValueAtTime(0, now);
        newGainNode.gain.linearRampToValueAtTime(finalVolume, now + crossfadeTime);

        newSource.connect(newGainNode);
        newGainNode.connect(this.masterGain);

        newSource.start(now, offset);

        // Fade out old one
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + crossfadeTime);

        const oldSource = voice.source;
        const oldGain = voice.gain;

        // Update voice object
        voice.source = newSource;
        voice.gain = newGainNode;

        // Re-apply tremulants to the new source
        this.updateTremulants(this.lastActiveTremulants);

        setTimeout(() => {
            try {
                oldSource.stop();
                oldSource.disconnect();
                oldGain.disconnect();
            } catch (e) { /* ignore */ }
        }, (crossfadeTime + 0.1) * 1000);
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
        this.lastActiveTremulants = allActiveTremulants;
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

            // Start hysteresis timer for the buffers
            const bufferKey = `${v.stopId}-${v.pipePath}`;
            if (this.unloadTimeouts[bufferKey]) {
                clearTimeout(this.unloadTimeouts[bufferKey]);
            }
            this.unloadTimeouts[bufferKey] = setTimeout(() => {
                this.tryUnloadFullBuffer(v.stopId, v.pipePath);
                delete this.unloadTimeouts[bufferKey];
            }, 5000);

            if (v.releasePath) {
                const relKey = `${v.stopId}-${v.releasePath}`;
                if (this.unloadTimeouts[relKey]) clearTimeout(this.unloadTimeouts[relKey]);
                this.unloadTimeouts[relKey] = setTimeout(() => {
                    this.tryUnloadFullBuffer(v.stopId, v.releasePath!);
                    delete this.unloadTimeouts[relKey];
                }, 5000);
            }
        });
    }

    private tryUnloadFullBuffer(stopId: string, pipePath: string) {
        const key = `${stopId}-${pipePath}`;
        const sample = this.buffers[key];
        if (!sample || sample.status !== 'full') return;

        // Don't unload if stop is not selected? 
        // Actually, if note is not playing, we can revert to partial if stop IS selected.
        // If stop is NOT selected, we should have already unloaded everything.

        // Check if any active voice is still using this buffer
        const isStillInUse = this.activeVoices.some(v =>
            (v.stopId === stopId && v.pipePath === pipePath) ||
            (v.stopId === stopId && v.releasePath === pipePath)
        );

        if (!isStillInUse) {
            const oldStatus = sample.status;
            sample.full = null;
            if (sample.partial) {
                sample.status = 'partial';
            } else {
                sample.status = 'none';
            }
            console.log(`[Synth] Unloaded full buffer for ${key} (previous status: ${oldStatus}), reverted to ${sample.status}`);
        } else {
            console.log(`[Synth] Skipping unload for ${key} - still in use by active voices.`);
        }
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
            const relSample = this.buffers[relKey];
            const relBuffer = relSample?.full || relSample?.partial;

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

    markStopDeselected(stopId: string) {
        this.selectedStops.delete(stopId);
        this.unloadStop(stopId);
    }

    private unloadStop(stopId: string) {
        Object.keys(this.buffers).forEach(key => {
            if (key.startsWith(`${stopId}-`)) {
                if (this.unloadTimeouts[key]) {
                    clearTimeout(this.unloadTimeouts[key]);
                    delete this.unloadTimeouts[key];
                }
                const sample = this.buffers[key];
                if (sample) {
                    sample.full = null;
                    sample.partial = null;
                    sample.status = 'none';
                }
                delete this.buffers[key];
                delete this.metadata[key];
            }
        });
        console.log(`[Synth] Unloaded all samples for stop: ${stopId}`);
    }

    clearAll() {
        this.activeVoices.forEach(v => this.stopVoice(v));
        this.activeVoices = [];
        this.requestedNotes.clear();
    }

    close() {
        this.clearAll();
        if (this.context.state !== 'closed') {
            this.context.close();
        }
    }

    getStats() {
        const stats = {
            activeStops: this.selectedStops.size,
            partialSamples: 0,
            fullSamples: 0,
            totalRamEstimateBytes: 0,
            activeVoices: this.activeVoices.length,
            loadingTasks: Object.keys(this.loadingTasks).length,
            loadedStopsCount: new Set(Object.keys(this.buffers).map(k => k.split('-')[0])).size
        };

        Object.values(this.buffers).forEach(sample => {
            if (sample.partial) {
                stats.partialSamples++;
                stats.totalRamEstimateBytes += sample.partial.length * sample.partial.numberOfChannels * 4;
            }
            if (sample.full) {
                stats.fullSamples++;
                stats.totalRamEstimateBytes += sample.full.length * sample.full.numberOfChannels * 4;
            }
        });

        return stats;
    }

    getStopBufferCount(stopId: string) {
        return Object.keys(this.buffers).filter(k => k.startsWith(`${stopId}-`)).length;
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
