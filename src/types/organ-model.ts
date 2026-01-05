// src/types/organ-model.ts

export interface GenericPipe {
    id: string; // "RankID_PipeIndex" or similar unique key
    midiNote: number;
    wavPath: string;
    // Normalized acoustic properties (Calculated from Organ + Windchest + Rank + Pipe levels)
    gain: number; // dB
    tuning: number; // cents (including temperament corrections)
    trackerDelay: number; // ms
    harmonicNumber: number;

    // Release handling
    releasePath?: string | undefined;
    releaseGain?: number | undefined; // dB
    isPercussive: boolean; // If true, ignores release/loop logic usually? Or handled by WAV.

    // Aux Info
    manualId?: string | undefined; // If tied to a specific manual (less common usually via Stop)
}

export interface GenericRank {
    id: string;
    name: string;
    pipes: Record<number, GenericPipe>; // Keyed by MIDI note (or logical index if needed)
    gain: number; // dB
    windchestId?: string;
}

export interface GenericStop {
    id: string;
    name: string;
    manualId: string;
    rankIds: string[]; // Ranks controlled by this stop

    // Per-Stop Adjustments (optional, usually applied at pipe level in model, but kept for UI/Logic)
    gain: number;
    pitchShift: number; // Coarse shift (semitones)

    displayed: boolean;
}

export interface GenericCoupler {
    id: string;
    name: string;
    manualId: string; // Source Manual
    destinationManualId?: string; // Dest Manual (if null, unchecked, acts as blind?)
    couplingType: 'UnisonOff' | 'Normal' | 'Melody' | 'Bass';
    keyShift: number; // Semitones
    // Recursion flags
    coupleToSubsequentUnison: boolean;
    coupleToSubsequentUpward: boolean;
    coupleToSubsequentDownward: boolean;
}

export interface GenericManual {
    id: string;
    name: string;
    stopIds: string[];
    couplerIds: string[];
    tremulantIds: string[];
    gain: number;

    // Key range
    firstKey: number; // MIDI note
    lastKey: number; // MIDI note

    displayed: boolean;
}

export interface GenericTremulant {
    id: string;
    name: string;
    type: 'Synth' | 'Wave';

    // Synth Params
    period?: number; // ms
    ampModDepth?: number; // % or fraction
    pitchModDepth?: number;
    startRate?: number;
    stopRate?: number;

    // Wave Params (if needed later)
}

export interface GenericEnclosure {
    id: string;
    name: string;
    ampMinimumLevel: number; // 0-100? or normalized 0-1
    currValue: number; // Dynamic state, but model might define defaults
    midiInputNumber: number; // for auto-mapping

    displayed: boolean;
}

export interface GenericWindchest {
    id: string;
    name: string;
    enclosureIds: string[];
    tremulantIds: string[];

    // Base acoustic properties
    gain: number;
    tuning: number;
    trackerDelay: number;
}

export interface OrganModel {
    name: string;
    basePath: string;
    sourcePath?: string; // Optional full path to ODF/XML

    manuals: GenericManual[];
    stops: Record<string, GenericStop>;
    couplers: Record<string, GenericCoupler>;
    ranks: Record<string, GenericRank>;
    tremulants: Record<string, GenericTremulant>;
    enclosures: Record<string, GenericEnclosure>;
    windchests: Record<string, GenericWindchest>;

    // Screen/GUI Data
    screens: OrganScreenData[];
    globalGain: number;
}

export interface OrganScreenElement {
    id: string;
    type: 'Switch' | 'Image' | 'Label';
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;

    // For Switches
    linkId?: string; // Stop/Coupler/Tremulant ID
    imageOn?: string;
    imageOff?: string;

    // For Static Images
    // imageOff serves as the image source

    // For Labels
    text?: string;
    color?: string;
}

export interface OrganScreenData {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundImage?: string;
    elements: OrganScreenElement[];
}
