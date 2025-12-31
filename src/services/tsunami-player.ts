interface VoiceSlot {
    audio: HTMLAudioElement;
    source: MediaElementAudioSourceNode;
    gainNode: GainNode;
    note: number | null;
    startTime: number;
}

export class TsunamiPlayer {
    private context: AudioContext;
    private masterGain: GainNode;
    private slots: VoiceSlot[] = [];
    private readonly MAX_VOICES = 16;

    constructor() {
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.context.destination);

        // Initialize pool of voice slots
        for (let i = 0; i < this.MAX_VOICES; i++) {
            const audio = new Audio();
            audio.crossOrigin = 'anonymous'; // Important for media element source
            const source = this.context.createMediaElementSource(audio);
            const gainNode = this.context.createGain();

            source.connect(gainNode);
            gainNode.connect(this.masterGain);

            this.slots.push({
                audio,
                source,
                gainNode,
                note: null,
                startTime: 0
            });
        }
    }

    /**
     * Plays a note by streaming from the given path immediately.
     */
    playNote(note: number, path: string) {
        if (this.context.state === 'suspended') {
            this.context.resume();
        }

        // Kill any existing voice with the same note (re-trigger)
        this.killNote(note);

        // Find a free slot, or steal the oldest one
        let slot: VoiceSlot | undefined = this.slots.find(s => s.note === null);
        if (!slot) {
            slot = this.stealOldestVoice() || undefined;
        }

        if (!slot) return; // Should not happen with steal logic

        // Setup slot
        slot.note = note;
        slot.startTime = this.context.currentTime;
        slot.gainNode.gain.cancelScheduledValues(slot.startTime);
        slot.gainNode.gain.setValueAtTime(1.0, slot.startTime);

        // Set source and play immediately (streaming)
        const streamUrl = `tsunami://${path}`;
        slot.audio.src = streamUrl;
        slot.audio.play().catch(e => console.error('Tsunami stream error:', e));

        // Clean up when finished naturally
        const onEnded = () => {
            if (slot.note === note) {
                slot.note = null;
            }
            slot.audio.removeEventListener('ended', onEnded);
        };
        slot.audio.addEventListener('ended', onEnded);
    }

    private stealOldestVoice(): VoiceSlot | null {
        let oldestSlot: VoiceSlot | null = null;
        let earliestTime = Infinity;

        for (const slot of this.slots) {
            if (slot.startTime < earliestTime) {
                earliestTime = slot.startTime;
                oldestSlot = slot;
            }
        }

        if (oldestSlot) {
            this.killSlot(oldestSlot);
            return oldestSlot;
        }
        return null;
    }

    /**
     * Immediate cutoff of a note.
     */
    killNote(note: number) {
        const slot = this.slots.find(s => s.note === note);
        if (slot) {
            this.killSlot(slot);
        }
    }

    private killSlot(slot: VoiceSlot) {
        slot.audio.pause();
        slot.audio.src = '';
        slot.note = null;
    }

    /**
     * Stops a note with a 50ms fade-out.
     */
    stopNote(note: number) {
        const slot = this.slots.find(s => s.note === note);
        if (slot) {
            const fadeTime = 0.05; // 50ms
            const now = this.context.currentTime;

            slot.gainNode.gain.cancelScheduledValues(now);
            slot.gainNode.gain.setValueAtTime(slot.gainNode.gain.value, now);
            slot.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);

            setTimeout(() => {
                if (slot.note === note) {
                    this.killSlot(slot);
                }
            }, fadeTime * 1000 + 10);
        }
    }

    clearAll() {
        for (const slot of this.slots) {
            this.killSlot(slot);
        }
    }

    // Compat helper for UI (active notes tracking is handled in Vue component)
    getActiveVoiceCount(): number {
        return this.slots.filter(s => s.note !== null).length;
    }
}

export const tsunamiPlayer = new TsunamiPlayer();
