
interface TsunamiVoice {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    startTime: number;
    note: number;
}

export class TsunamiPlayer {
    private context: AudioContext;
    private buffers: Map<string, AudioBuffer> = new Map();
    private activeVoices: Map<number, TsunamiVoice> = new Map(); // Map note -> voice
    private masterGain: GainNode;
    private loadPromises: Map<string, Promise<void>> = new Map();

    constructor() {
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = 1.0; // Full volume
        this.masterGain.connect(this.context.destination);
    }

    async loadSample(trackKey: string, path: string): Promise<void> {
        if (this.buffers.has(trackKey)) return;
        if (this.loadPromises.has(trackKey)) return this.loadPromises.get(trackKey);

        const promise = (async () => {
            try {
                const arrayBuffer = await (window as any).myApi.readFileAsArrayBuffer(path);
                const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
                this.buffers.set(trackKey, audioBuffer);
            } catch (e) {
                console.error(`Failed to load tsunami sample: ${path}`, e);
            } finally {
                this.loadPromises.delete(trackKey);
            }
        })();

        this.loadPromises.set(trackKey, promise);
        return promise;
    }

    playNote(note: number, trackKey: string) {
        if (this.context.state === 'suspended') {
            this.context.resume();
        }

        // Hard voice stealing for the same note
        this.killNote(note);

        // Global 32-voice limit
        if (this.activeVoices.size >= 32) {
            this.stealOldestVoice();
        }

        const buffer = this.buffers.get(trackKey);
        if (!buffer) {
            console.warn(`Buffer not found for key: ${trackKey}`);
            return;
        }

        const gainNode = this.context.createGain();
        gainNode.gain.value = 1.0;
        gainNode.connect(this.masterGain);

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = false;

        source.connect(gainNode);
        source.start();

        const voice: TsunamiVoice = {
            source,
            gainNode,
            startTime: this.context.currentTime,
            note
        };

        source.onended = () => {
            // Remove if this is still the active voice for this note
            if (this.activeVoices.get(note) === voice) {
                this.activeVoices.delete(note);
            }
        };

        this.activeVoices.set(note, voice);
    }

    private stealOldestVoice() {
        let oldestNote: number | null = null;
        let earliestTime = Infinity;

        this.activeVoices.forEach((voice, note) => {
            if (voice.startTime < earliestTime) {
                earliestTime = voice.startTime;
                oldestNote = note;
            }
        });

        if (oldestNote !== null) {
            this.killNote(oldestNote);
        }
    }

    /**
     * Immediate cutoff of a note (no fade).
     * Used for voice stealing and clearAll.
     */
    killNote(note: number) {
        const voice = this.activeVoices.get(note);
        if (voice) {
            try {
                voice.source.stop();
                voice.source.disconnect();
                voice.gainNode.disconnect();
            } catch (e) {
                // ignore
            }
            this.activeVoices.delete(note);
        }
    }

    /**
     * Stops a note with a 50ms fade-out.
     */
    stopNote(note: number) {
        const voice = this.activeVoices.get(note);
        if (voice) {
            const fadeTime = 0.05; // 50ms
            const now = this.context.currentTime;

            // Ramp down gain
            voice.gainNode.gain.cancelScheduledValues(now);
            voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
            voice.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);

            // Schedule stop
            voice.source.stop(now + fadeTime);

            // We don't delete from activeVoices yet, because it still counts as a voice.
            // source.onended will handle the cleanup.
        }
    }

    clearAll() {
        this.activeVoices.forEach((_, note) => {
            this.killNote(note);
        });
        this.activeVoices.clear();
    }
}

export const tsunamiPlayer = new TsunamiPlayer();
