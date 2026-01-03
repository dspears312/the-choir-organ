import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('wavefile');
const WaveFile = pkg.WaveFile || pkg;
import fs from 'fs';
import path from 'path';
import { readWav } from './wav-reader';

const FIXED_ATTENUATION = 1; // -14dB headroom for polyphony

export interface RenderPipe {
    path: string;
    volume: number;
    isPedal: boolean;
    gain: number; // in dB
    pitchOffsetCents?: number; // For virtual stop shift
    harmonicNumber: number;
    manualId?: string;
    renderingNote?: number; // For virtual stop transposition
    delay?: number; // in ms
}

export async function renderNote(
    note: number,
    pipes: RenderPipe[],
    outputDir: string,
    trackNumber: number,
    globalGainDb: number,
    activeTremulants: any[] = []
) {
    const sampleRate = 44100;
    const totalSamples = sampleRate * 60;
    const outputBuffer = [new Float32Array(totalSamples), new Float32Array(totalSamples)];

    const globalGainLinear = Math.pow(10, (globalGainDb || 0) / 20);

    let activePipeCount = 0;

    for (const pipe of pipes) {
        try {
            const wavInfo = readWav(pipe.path);
            if (!wavInfo.data || wavInfo.data.length === 0) {
                console.warn(`No data for pipe: ${pipe.path}`);
                continue;
            }

            const stopVolumeScale = pipe.volume / 100;
            const combinedGainDb = (globalGainDb || 0) + (pipe.gain || 0);
            const odfGainLinear = Math.pow(10, combinedGainDb / 20);
            const masterAttenuation = 0.5;

            // Tuning calculation
            let wavTuningPercent = 0;
            const pitchRefNote = pipe.renderingNote !== undefined ? pipe.renderingNote : note;

            if (wavInfo.unityNote !== undefined && !isNaN(wavInfo.unityNote) && wavInfo.unityNote > 0 && wavInfo.unityNote < 128) {
                wavTuningPercent = (pitchRefNote - wavInfo.unityNote) * 100;

                if (wavInfo.pitchFraction !== undefined && !isNaN(wavInfo.pitchFraction) && wavInfo.pitchFraction !== 0) {
                    const fractionCents = (wavInfo.pitchFraction / 4294967296) * 100;
                    wavTuningPercent -= fractionCents;
                }
            }

            const harmonicCents = 1200 * Math.log2(pipe.harmonicNumber / 8);
            // We ignore pipe.tuning as per user instruction and use virtual pitchOffsetCents
            const totalCents = (pipe.pitchOffsetCents || 0) + wavTuningPercent + harmonicCents;
            const pitchRate = isNaN(totalCents) ? 1.0 : Math.pow(2, totalCents / 1200);

            const rateRatio = (wavInfo.sampleRate || 44100) / sampleRate;
            const playbackRate = pitchRate * rateRatio;

            let pedalScale = 1.0;
            if (pipe.isPedal) {
                pedalScale = Math.max(0, 1.0 - (note - 36) * (1.0 / 24));
            }

            const finalScale = stopVolumeScale * odfGainLinear * (FIXED_ATTENUATION * masterAttenuation) * pedalScale;

            const tremulantsForPipe = activeTremulants.filter(t => !t.manualId || String(t.manualId) === String(pipe.manualId));

            layerSample(outputBuffer, wavInfo, finalScale, playbackRate, tremulantsForPipe, pipe.delay || 0);
            activePipeCount++;
        } catch (e) {
            console.error(`Failed to layer pipe ${pipe.path}:`, e);
        }
    }

    if (activePipeCount === 0) return; // Silent output, skip writing file

    const int16Buffer = [new Int16Array(totalSamples), new Int16Array(totalSamples)];
    for (let c = 0; c < 2; c++) {
        const channel = outputBuffer[c];
        const target = int16Buffer[c];
        if (!channel || !target) continue;
        for (let i = 0; i < totalSamples; i++) {
            let sample = channel[i] || 0;
            if (sample > 1.0) sample = 1.0;
            else if (sample < -1.0) sample = -1.0;
            target[i] = Math.round(sample * 32767);
        }
    }

    const wav = new WaveFile();
    wav.fromScratch(2, sampleRate, '16', int16Buffer);

    if (!(wav as any).smpl) {
        (wav as any).smpl = { loops: [] };
    }
    (wav as any).smpl.loops = [{
        dwIdentifier: 0,
        dwType: 0,
        dwStart: 0,
        dwEnd: totalSamples - 1,
        dwFraction: 0,
        dwPlayCount: 0
    }];

    const fileName = `${trackNumber.toString().padStart(4, '0')}.wav`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, wav.toBuffer());
}

// Wrapper for existing single-note rendering
function layerSample(
    target: Float32Array[],
    source: any,
    scale: number,
    playbackRate: number,
    tremulants: any[] = [],
    delayMs: number = 0
) {
    mixSample(target, source, 0, null, scale, playbackRate, tremulants, delayMs, 0);
}

export async function renderPerformance(
    recording: any,
    organData: any,
    outputPath: string,
    renderTails: boolean,
    onProgress?: (progress: number) => void
) {
    const sampleRate = 44100;

    // Define events first so we can use them for timing calculation
    const events = recording.events.sort((a: any, b: any) => a.timestamp - b.timestamp);

    // Find start time (First NoteOn)
    // If we just use events[0], we might get 5 seconds of silence if the user waited to play.
    // We want to shift everything so the first NOTE starts at 0.
    // Any stop changes before that should be clamped to 0.
    const firstNoteEvent = events.find((e: any) => e.type === 'noteOn');
    const firstEventTime = firstNoteEvent ? firstNoteEvent.timestamp : (events.length > 0 ? events[0].timestamp : 0);

    // Initial buffer sizing (Safe overestimate)
    // Original duration was end - start. We keep relative duration but shift start to 0.
    // So new duration is (original_end - firstEventTime)
    // But `recording.duration` usually implies total length. 
    // If we shift events, we must reduce total duration by the shift amount.
    const shiftedDurationMs = recording.duration - firstEventTime;
    const totalDurationMs = shiftedDurationMs + 10000; // Add 10s tail
    const totalSamples = Math.ceil((totalDurationMs / 1000) * sampleRate);

    // Stereo Buffer
    const outputBuffer = [new Float32Array(totalSamples), new Float32Array(totalSamples)];

    // Dynamic State Tracking
    const activeStopIds = new Set<string>();
    const activeTremulants: any[] = [];

    // We already have `events` sorted by timestamp.
    // We iterate through ALL events.
    const totalEvents = events.length;

    for (let i = 0; i < totalEvents; i++) {
        const event = events[i];
        const shiftedStart = Math.max(0, event.timestamp - firstEventTime);

        if (event.type === 'stopOn' && event.stopId) {
            activeStopIds.add(event.stopId);
            if (event.stopId.startsWith('TREM_') && organData.tremulants) {
                const tId = event.stopId.replace('TREM_', '');
                const trem = organData.tremulants[tId];
                if (trem) activeTremulants.push(trem);
            }
        } else if (event.type === 'stopOff' && event.stopId) {
            activeStopIds.delete(event.stopId);
            if (event.stopId.startsWith('TREM_') && organData.tremulants) {
                const tId = event.stopId.replace('TREM_', '');
                const trem = organData.tremulants[tId];
                const idx = activeTremulants.indexOf(trem);
                if (idx !== -1) activeTremulants.splice(idx, 1);
            }
        } else if (event.type === 'noteOn') {
            const noteOn = event;
            // Find NoteOff
            const noteOff = events.find((e: any) =>
                e.type === 'noteOff' &&
                e.note === noteOn.note &&
                e.timestamp > noteOn.timestamp
            );

            let durationMs = 0;
            if (noteOff) {
                durationMs = noteOff.timestamp - noteOn.timestamp;
            } else {
                durationMs = totalDurationMs - noteOn.timestamp; // Held to end
            }

            // For this note, find all pipes belonging to currently active stops
            // Optimization: Iterate activeStopIds instead of all stops?
            // Depends on count. stops count ~50-100? active ~10-20.

            activeStopIds.forEach(stopId => {
                const stop = organData.stops[stopId];
                if (!stop) return; // specific volume checks removed, relying on active set

                const manual = organData.manuals.find((m: any) => String(m.id) === String(stop.manualId));
                const isPedal = manual?.name.toLowerCase().includes('pedal') || false;
                const noteOffset = stop.noteOffset || 0;
                const adjustedNote = noteOn.note + noteOffset;

                stop.rankIds.forEach((rankId: string) => {
                    const rank = organData.ranks[rankId];
                    if (rank) {
                        const pipe = rank.pipes.find((p: any) => p.midiNote === adjustedNote) || rank.pipes[adjustedNote - 36];
                        if (pipe) {
                            const combinedGain = (manual?.gain || 0) + (stop.gain || 0) + (rank.gain || 0) + (pipe.gain || 0);
                            const stopVolume = stop.volume || 100; // Default to 100 if missing

                            // Prepare render pipe info
                            const rp: RenderPipe = {
                                path: pipe.wavPath,
                                volume: stopVolume,
                                isPedal,
                                gain: combinedGain,
                                pitchOffsetCents: stop.pitchShift || 0,
                                harmonicNumber: (pipe.harmonicNumber || 1) * (stop.harmonicMultiplier || 1),
                                manualId: stop.manualId,
                                renderingNote: adjustedNote,
                                delay: stop.delay || 0
                            };

                            // RENDER LOGIC (Inline or call mix)
                            try {
                                const wavInfo = readWav(rp.path);
                                if (!wavInfo.data) return;

                                let wavTuningPercent = 0;
                                const pitchRefNote = rp.renderingNote !== undefined ? rp.renderingNote : noteOn.note;
                                if (wavInfo.unityNote !== undefined && !isNaN(wavInfo.unityNote)) {
                                    wavTuningPercent = (pitchRefNote - wavInfo.unityNote) * 100;
                                    if (wavInfo.pitchFraction) {
                                        const fractionCents = (wavInfo.pitchFraction / 4294967296) * 100;
                                        wavTuningPercent -= fractionCents;
                                    }
                                }
                                const harmonicCents = 1200 * Math.log2(rp.harmonicNumber / 8);
                                const totalCents = (rp.pitchOffsetCents || 0) + wavTuningPercent + harmonicCents;
                                const pitchRate = isNaN(totalCents) ? 1.0 : Math.pow(2, totalCents / 1200);
                                const rateRatio = (wavInfo.sampleRate || 44100) / sampleRate;
                                const playbackRate = pitchRate * rateRatio;
                                const globalGainLinear = Math.pow(10, (organData.globalGain || 0) / 20);
                                const stopVolumeScale = rp.volume / 100;
                                const odfGainLinear = Math.pow(10, (rp.gain || 0) / 20);
                                let pedalScale = 1.0;
                                if (rp.isPedal) {
                                    pedalScale = Math.max(0, 1.0 - (noteOn.note - 36) * (1.0 / 24));
                                }
                                const finalScale = stopVolumeScale * odfGainLinear * globalGainLinear * pedalScale * FIXED_ATTENUATION;

                                // Mix Sustain and Release with simultaneous crossfade
                                // We ensure the Release starts fading IN exactly when the Sustain starts fading OUT.
                                const crossfadeS = renderTails ? 0.05 : 0.2; // 50ms crossfade for tails
                                const sustainDuration = durationMs + (crossfadeS * 1000);

                                const tremulantsForPipe = activeTremulants.filter(t => !t.manualId || String(t.manualId) === String(rp.manualId)); // activeTremulants is global to organData for now

                                mixSample(
                                    outputBuffer,
                                    wavInfo,
                                    shiftedStart,
                                    sustainDuration,
                                    finalScale,
                                    playbackRate,
                                    tremulantsForPipe,
                                    rp.delay || 0,
                                    crossfadeS,
                                    0 // No fade in for sustain (attack is natural)
                                );

                                // Mix Release (Tails)
                                if (renderTails) {
                                    let relPath = (pipe as any).releasePath;
                                    let relInfo = null;
                                    if (relPath) {
                                        relInfo = readWav(relPath);
                                    }

                                    if (relInfo && relInfo.data) {
                                        // To ensure no gap, we start the release exactly at NoteOff (durationMs)
                                        // The Release Fades IN over 'crossfadeS`.
                                        // The Sustain Fades OUT over 'crossfadeS' starting at 'durationMs'.
                                        mixSample(
                                            outputBuffer,
                                            relInfo,
                                            shiftedStart + durationMs,
                                            null, // Play full release
                                            finalScale,
                                            playbackRate, // Same pitch
                                            tremulantsForPipe,
                                            0, // Delay
                                            0.0, // No fade out for release
                                            crossfadeS // Fade IN for release, simultaneous with sustain fade out
                                        );
                                    }
                                }

                            } catch (e) { console.error(e); }
                        }
                    }
                });
            });
        }

        // Report Progress
        // if (onProgress && i % 50 === 0) {
        const progress = Math.round(((i + 1) / totalEvents) * 100);
        onProgress(progress);
        // }
    }
    if (onProgress) onProgress(100);

    // Trim End Silence
    // Scan backwards to find the last signal meeting a threshold
    const threshold = 0.0001; // Approx -80dB
    let lastSignalIndex = 0;
    const len = outputBuffer[0].length;
    for (let i = len - 1; i >= 0; i--) {
        if (Math.abs(outputBuffer[0][i]) > threshold || Math.abs(outputBuffer[1][i]) > threshold) {
            lastSignalIndex = i;
            break;
        }
    }

    // Add a small safety pad (e.g. 100ms)
    const padSamples = Math.floor(0.1 * sampleRate);
    const trimmedLength = Math.min(len, lastSignalIndex + padSamples);

    // Create final trimmed buffers
    const finalBufferL = outputBuffer[0].slice(0, trimmedLength);
    const finalBufferR = outputBuffer[1].slice(0, trimmedLength);

    // Write Output
    const int16Buffer = [new Int16Array(trimmedLength), new Int16Array(trimmedLength)];
    for (let i = 0; i < trimmedLength; i++) {
        for (let channel = 0; channel < 2; channel++) {
            const src = channel === 0 ? finalBufferL : finalBufferR;
            let sample = src[i];
            if (sample > 1.0) sample = 1.0;
            else if (sample < -1.0) sample = -1.0;
            int16Buffer[channel][i] = Math.round(sample * 32767);
        }
    }

    const wav = new WaveFile();
    wav.fromScratch(2, sampleRate, '16', int16Buffer);
    fs.writeFileSync(outputPath, wav.toBuffer());
}


function mixSample(
    target: Float32Array[],
    source: any,
    startTimeMs: number,
    durationMs: number | null,
    scale: number,
    playbackRate: number,
    tremulants: any[] = [],
    delayMs: number = 0,
    fadeOutS: number = 0,
    fadeInS: number = 0
) {
    const channel0 = target[0]!;
    const channel1 = target[1]!;
    const sampleRate = 44100;

    const startSample = Math.floor(startTimeMs / 1000 * sampleRate);
    const delaySamples = Math.floor(delayMs / 1000 * sampleRate);
    const absStart = startSample + delaySamples;

    if (absStart >= channel0.length) return;

    const srcData = source.data;
    if (!srcData) return;
    const srcL = srcData[0];
    const srcR = srcData[1] || srcL;
    const loop = source.loops[0];

    const maxDurationSamples = durationMs ? Math.floor(durationMs / 1000 * sampleRate) : 999999999;

    let srcIdx = 0;
    let outIdx = absStart;
    let samplesPlayed = 0;

    while (outIdx < channel0.length && samplesPlayed < maxDurationSamples) {
        let currentScale = scale;
        let pRate = playbackRate;

        // Apply Tremulants
        if (tremulants.length > 0) {
            const time = samplesPlayed / sampleRate;
            let amCorrect = 1.0;
            let fmCorrect = 0.0;

            for (const trem of tremulants) {
                const freq = trem.frequency || 5.0;
                const phase = (time * freq * 2 * Math.PI);
                const sinVal = Math.sin(phase);

                // AM
                if (trem.ampModDepth) {
                    amCorrect *= (1.0 + (sinVal * trem.ampModDepth));
                }

                // FM (Pitch modulation)
                if (trem.freqModDepth) {
                    fmCorrect += (sinVal * trem.freqModDepth);
                }
            }
            currentScale *= amCorrect;

            // FM modulation affects playback speed
            // If depth ~0.05, rate varies by +/- 5%
            pRate *= (1.0 + fmCorrect);
        }

        // Fade In Logic
        if (fadeInS && samplesPlayed < (fadeInS * sampleRate)) {
            const fadeLen = fadeInS * sampleRate;
            currentScale *= (samplesPlayed / fadeLen);
        }

        // Fade Out Logic
        if (durationMs && samplesPlayed > maxDurationSamples - (fadeOutS * sampleRate)) {
            const fadeLen = fadeOutS * sampleRate;
            const samplesFromEnd = maxDurationSamples - samplesPlayed;
            currentScale *= (samplesFromEnd / fadeLen);
        }

        // Interpolate
        const baseIdx = Math.floor(srcIdx);
        const frac = srcIdx - baseIdx;
        const nextIdx = baseIdx + 1;

        let sampleL = 0;
        let sampleR = 0;

        if (baseIdx < srcL.length) {
            const v1L = srcL[baseIdx] ?? 0;
            const nextValL = (nextIdx < srcL.length) ? (srcL[nextIdx] ?? 0) : (loop ? (srcL[loop.start + (nextIdx - loop.end)] ?? v1L) : v1L);
            sampleL = v1L + frac * (nextValL - v1L);

            const v1R = srcR[baseIdx] ?? 0;
            const nextValR = (nextIdx < srcR.length) ? (srcR[nextIdx] ?? 0) : (loop ? (srcR[loop.start + (nextIdx - loop.end)] ?? v1R) : v1R);
            sampleR = v1R + frac * (nextValR - v1R);

            if (channel0) channel0[outIdx] += sampleL * currentScale;
            if (channel1) channel1[outIdx] += sampleR * currentScale;
        } else {
            break; // End of non-looping sample
        }

        srcIdx += pRate;
        outIdx++;
        samplesPlayed++;

        // Loop Logic
        if (loop && typeof loop.start === 'number' && typeof loop.end === 'number') {
            if (srcIdx >= loop.end) {
                srcIdx = loop.start + (srcIdx - loop.end);
            }
        } else if (srcIdx >= srcL.length) {
            break;
        }
    }
}
