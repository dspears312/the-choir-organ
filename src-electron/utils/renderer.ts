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

            layerSample(outputBuffer, wavInfo, finalScale, playbackRate, tremulantsForPipe);
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

function layerSample(
    target: Float32Array[],
    source: any,
    scale: number,
    playbackRate: number,
    tremulants: any[] = []
) {
    const channel0 = target[0];
    const channel1 = target[1];
    if (!channel0 || !channel1) return;

    const srcData = source.data;
    if (!srcData || srcData.length === 0) return;

    const srcL = srcData[0] as Float32Array;
    const srcR = (srcData[1] || srcL) as Float32Array;
    const loop = source.loops[0];

    let srcIdx = 0;
    const sampleRate = 44100;

    for (let i = 0; i < channel0.length; i++) {
        let currentScale = scale;
        let currentPlaybackRate = playbackRate;

        for (const trem of tremulants) {
            let ampDepth = trem.ampModDepth || 0;
            let pitchDepth = trem.pitchModDepth || 0;

            if (ampDepth === 0 && pitchDepth === 0) {
                ampDepth = 10;
                pitchDepth = 1.0;
            }

            const timeInSec = i / sampleRate;
            const phase = (timeInSec * 1000 / (trem.period || 200)) * 2 * Math.PI;

            if (ampDepth > 0) {
                const ampMod = 1 + (ampDepth / 100) * Math.sin(phase);
                currentScale *= ampMod;
            }

            if (pitchDepth > 0) {
                const freqMod = 1 + (pitchDepth / 100) * Math.sin(phase);
                currentPlaybackRate *= freqMod;
            }
        }

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
        }

        channel0![i] += sampleL * currentScale;
        channel1![i] += sampleR * currentScale;

        srcIdx += currentPlaybackRate;

        if (loop && typeof loop.start === 'number' && typeof loop.end === 'number') {
            if (srcIdx >= loop.end) {
                srcIdx = loop.start + (srcIdx - loop.end);
            }
        } else {
            if (srcIdx >= srcL.length) {
                break;
            }
        }
    }
}
