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
    type: 'noteOn' | 'noteOff' | 'stopOn' | 'stopOff' | 'bankChange';
    note?: number;
    stopId?: string;
    velocity?: number;
    bankIndex?: number;
}

// Advanced Audio Settings
export interface OrganAudioSettings {
    disabledRanks: string[]; // IDs of disabled ranks
    releaseMode: 'authentic' | 'convolution' | 'none';
    reverbMix: number; // 0-1
    reverbLength: number; // seconds
    loadingMode: 'none' | 'quick' | 'full';
}

export const DEFAULT_AUDIO_SETTINGS: OrganAudioSettings = {
    disabledRanks: [],
    releaseMode: 'authentic',
    reverbMix: 0.3,
    reverbLength: 2.0,
    loadingMode: 'none'
};

export interface RecordingSession {
    id: string;
    name: string;
    date: number;
    duration: number; // ms
    events: TimelineEvent[];
}
