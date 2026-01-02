import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ini = require('ini');
import fs from 'fs';
import path from 'path';

export interface OrganPipe {
  pitch: string;
  wavPath: string;
  releasePath?: string | undefined;
  midiNote: number;
  gain: number; // in dB
  pan?: number; // -100 to 100 or specific pan units
  tuning: number; // in cents
  harmonicNumber: number;
}

export interface OrganRank {
  name: string;
  gain: number;
  pipes: OrganPipe[];
}

export interface OrganStop {
  id: string;
  name: string;
  rankIds: string[];
  manualId: string;
  volume: number; // Default 100
  gain: number;
  displayed: boolean;
}

export interface OrganManual {
  id: string;
  name: string;
  gain: number;
  stopIds: string[];
}

export interface OrganTremulant {
  id: string;
  name: string;
  type: 'Synth' | 'Wave';
  period: number; // in ms
  ampModDepth: number; // in %
  pitchModDepth: number; // in %
  manualId?: string;
}

export interface OrganScreenElement {
  id: string;
  type: 'Switch' | 'Label' | 'Image';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageOn?: string | undefined;
  imageOff?: string | undefined;
  linkId?: string | undefined; // ID of the global Switch or Stop it controls
  zIndex?: number;
}

export interface OrganScreenData {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundImage?: string | undefined;
  elements: OrganScreenElement[];
  zIndex?: number;
}

export interface OrganData {
  name: string;
  globalGain: number; // Global gain in dB from [Organ] section
  stops: Record<string, OrganStop>;
  manuals: OrganManual[];
  ranks: Record<string, OrganRank>;
  tremulants: Record<string, OrganTremulant>;
  screens: OrganScreenData[];
  basePath: string;
  sourcePath: string;
}

export const NOISE_KEYWORDS = ['noise', 'tracker', 'blower', 'motor', 'action', 'vental', 'tremulant noise', 'drawknob', 'stop action', 'special'];

function normalizeId(id: string | number): string {
  if (typeof id === 'number') return id.toString().padStart(3, '0');
  const s = id.toString().trim();
  if (/^\d+$/.test(s)) return s.padStart(3, '0');
  return s;
}

/**
 * Recursively restore a placeholder in a parsed object
 */
function restoreSharps(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/§SHARP§/g, '#');
  } else if (Array.isArray(obj)) {
    return obj.map(restoreSharps);
  } else if (typeof obj === 'object' && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = restoreSharps(obj[key]);
    }
    return newObj;
  }
  return obj;
}

function parseGain(section: any, prefix: string = ''): number {
  let g = 0;
  if (section[prefix + 'Gain'] !== undefined) {
    g += parseFloat(section[prefix + 'Gain']);
  }
  if (section[prefix + 'Amplitude'] !== undefined) {
    const amp = parseFloat(section[prefix + 'Amplitude']);
    if (amp > 0) {
      // 20 * log10(amp/100) is standard for GO ODFs where 100 is 0dB
      g += 20 * Math.log10(amp / 100);
    }
  }

  if (!prefix && section['AmplitudeLevel'] !== undefined) {
    const amp = parseFloat(section['AmplitudeLevel']);
    if (amp > 0) {
      g += 20 * Math.log10(amp / 100);
    }
  }

  // NEW CHECK: Check for prefixed AmplitudeLevel (e.g. Pipe001AmplitudeLevel)
  if (section[prefix + 'AmplitudeLevel'] !== undefined) {
    const amp = parseFloat(section[prefix + 'AmplitudeLevel']);
    if (amp > 0) {
      g += 20 * Math.log10(amp / 100);
    }
  }

  return isNaN(g) ? 0 : g;
}

export function parseODF(filePath: string): OrganData {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/#/g, '§SHARP§');
  let parsed = ini.parse(content);
  parsed = restoreSharps(parsed);

  const basePath = path.dirname(filePath);

  const organData: OrganData = {
    name: parsed.Organ?.Name || parsed.Organ?.ChurchName || parsed.Organ?.Church || parsed.Organ?.['Organ Info'] || 'Unknown Organ',
    globalGain: parseGain(parsed.Organ || {}),
    stops: {},
    manuals: [],
    ranks: {},
    tremulants: {},
    screens: [],
    basePath,
    sourcePath: filePath
  };

  // 0a. Extract Panels (Screens)
  const panels: Record<string, any> = {};
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('Panel') && !key.includes('Switch') && !key.includes('Image') && !key.includes('Label')) {
      const panelId = normalizeId(key.replace('Panel', ''));
      panels[panelId] = parsed[key];
    }
  });

  const allSwitches: Record<string, any> = {};
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('Switch')) {
      const switchId = normalizeId(key.replace('Switch', ''));
      allSwitches[switchId] = parsed[key];
    }
  });

  Object.keys(panels).forEach(panelId => {
    const panel = panels[panelId];
    const screen: OrganScreenData = {
      id: panelId,
      name: panel.Name || `Panel ${panelId}`,
      width: parseInt(panel.DispScreenSizeHoriz || '1024'),
      height: parseInt(panel.DispScreenSizeVert || '768'),
      elements: []
    };

    // Background images for panels
    const numPanelImages = parseInt(panel.NumberOfImages || '0');
    for (let i = 1; i <= numPanelImages; i++) {
      const imgKey = `Panel${panelId}Image${i.toString().padStart(3, '0')}`;
      const imgData = parsed[imgKey];
      if (imgData && imgData.Image) {
        // Usually the first image is the background
        const imgPath = path.resolve(basePath, imgData.Image.replace(/\\/g, '/'));
        if (i === 1) screen.backgroundImage = imgPath;
        else {
          screen.elements.push({
            id: `${panelId}_img_${i}`,
            type: 'Image',
            name: `Image ${i}`,
            x: parseInt(imgData.PositionX || '0'),
            y: parseInt(imgData.PositionY || '0'),
            width: 0, // Need to load image to know size, or it might be in ODF
            height: 0,
            imageOff: imgPath
          });
        }
      }
    }

    // Switches on panels
    const numPanelSwitches = parseInt(panel.NumberOfSwitches || '0');
    for (let i = 1; i <= numPanelSwitches; i++) {
      const psKey = `Panel${panelId}Switch${i.toString().padStart(3, '0')}`;
      const psData = parsed[psKey];
      if (psData) {
        const switchId = normalizeId(psData.Switch || psData.SwitchID || '001');
        const globalSwitch = allSwitches[switchId];
        if (globalSwitch) {
          screen.elements.push({
            id: `${panelId}_sw_${switchId}`,
            type: 'Switch',
            name: globalSwitch.Name || `Switch ${switchId}`,
            x: parseInt(globalSwitch.PositionX || '0'),
            y: parseInt(globalSwitch.PositionY || '0'),
            width: parseInt(globalSwitch.MouseRectWidth || '50'),
            height: parseInt(globalSwitch.MouseRectHeight || '50'),
            imageOn: globalSwitch.ImageOn ? path.resolve(basePath, globalSwitch.ImageOn.replace(/\\/g, '/')) : undefined,
            imageOff: globalSwitch.ImageOff ? path.resolve(basePath, globalSwitch.ImageOff.replace(/\\/g, '/')) : undefined,
            linkId: switchId
          });
        }
      }
    }

    organData.screens.push(screen);
  });

  // 0. Extract Tremulants
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('Tremulant')) {
      const tremId = normalizeId(key.replace('Tremulant', ''));
      const trem = parsed[key];
      if (trem) {
        organData.tremulants[tremId] = {
          id: tremId,
          name: trem.Name || `Tremulant ${tremId}`,
          type: trem.TremulantType === 'Wave' ? 'Wave' : 'Synth',
          period: parseInt(trem.Period || '200'),
          ampModDepth: parseFloat(trem.AmpModDepth || '0'),
          pitchModDepth: parseFloat(trem.PitchModDepth || '0'),
        };
        console.log(`[Parser] Found Tremulant: ${tremId} (${organData.tremulants[tremId].name})`);
      }
    }
  });

  // 0b. Extract Windchest Groups and their tremulants
  const windchestTremulants: Record<string, string[]> = {};
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('WindchestGroup')) {
      const wcgId = normalizeId(key.replace('WindchestGroup', ''));
      const wcg = parsed[key];
      const trems: string[] = [];
      const numTrems = parseInt(wcg.NumberOfTremulants || '0');
      for (let i = 1; i <= numTrems; i++) {
        const tremKey = `Tremulant${i.toString().padStart(3, '0')}`;
        if (wcg[tremKey]) trems.push(normalizeId(wcg[tremKey]));
      }
      if (trems.length > 0) {
        windchestTremulants[wcgId] = trems;
        console.log(`[Parser] WindchestGroup ${wcgId} has tremulants: ${trems.join(', ')}`);
      }
    }
  });

  // 1. Extract Ranks
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('Rank')) {
      const rankId = normalizeId(key.replace('Rank', ''));
      const rank = parsed[key];
      const pipes: OrganPipe[] = [];

      const firstMidiNote = parseInt(rank.FirstMidiNoteNumber || '36');

      for (let i = 1; i <= 128; i++) {
        const pipeKeyStr = i.toString().padStart(3, '0');
        const pipeKey = `Pipe${pipeKeyStr}`;
        if (rank[pipeKey]) {
          const rawPath = rank[pipeKey].toString().trim();

          // Skip placeholders and malformed paths
          if (
            rawPath.toUpperCase() === 'DUMMY' ||
            rawPath.toUpperCase().endsWith('DUMMY') ||
            rawPath === '' ||
            rawPath === '0'
          ) {
            continue;
          }

          const pipeGain = parseGain(rank, pipeKey);
          // Tuning from rank or pipe (summing Tuning and Correction)
          const rankTuning = parseFloat(rank.PitchTuning || '0') + parseFloat(rank.PitchCorrection || '0');
          const pipeTuning = parseFloat(rank[`${pipeKey}PitchTuning`] || '0') + parseFloat(rank[`${pipeKey}PitchCorrection`] || '0');
          const totalTuning = rankTuning + pipeTuning;

          const rankHarmonic = parseFloat(rank.HarmonicNumber || '1');
          const pipeHarmonic = parseFloat(rank[`${pipeKey}HarmonicNumber`] || rankHarmonic.toString());

          const normalizedPath = rawPath.replace(/\\/g, '/');

          let releasePathVal: string | undefined = undefined;
          const releaseKey = `${pipeKey}Release001`;
          if (rank[releaseKey]) {
            const relRaw = rank[releaseKey].toString().trim();
            if (relRaw !== '0' && relRaw !== '' && relRaw.toUpperCase() !== 'DUMMY') {
              releasePathVal = path.resolve(basePath, relRaw.replace(/\\/g, '/'));
            }
          }

          const midiNoteOverride = rank[`${pipeKey}MIDIKeyNumber`] ? parseInt(rank[`${pipeKey}MIDIKeyNumber`].toString()) : NaN;

          pipes.push({
            pitch: i.toString(),
            wavPath: path.resolve(basePath, normalizedPath),
            releasePath: releasePathVal,
            midiNote: !isNaN(midiNoteOverride) ? midiNoteOverride : (firstMidiNote - 1) + i,
            gain: pipeGain,
            tuning: totalTuning,
            harmonicNumber: pipeHarmonic
          });
        }
      }

      organData.ranks[rankId] = {
        name: rank.Name || `Rank ${rankId}`,
        gain: parseGain(rank),
        pipes,
        windchestGroup: normalizeId(rank.WindchestGroup || '001')
      } as any;
    }
  });

  // 2. Extract all Stops
  const allStopsRaw: Record<string, any> = {};
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('Stop')) {
      const stopId = normalizeId(key.replace('Stop', ''));
      allStopsRaw[stopId] = parsed[key];
    }
  });

  // 3. Extract Manuals
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('Manual')) {
      const manualId = normalizeId(key.replace('Manual', ''));
      const manual = parsed[key];
      const mData: OrganManual = {
        id: manualId,
        name: manual.Name || `Manual ${manualId}`,
        gain: parseGain(manual),
        stopIds: []
      };

      // Link tremulants to manual (explicit)
      const explicitlyLinkedTrems = new Set<string>();
      const numTremulants = parseInt(manual.NumberOfTremulants || '0');
      for (let i = 1; i <= numTremulants; i++) {
        const tremKey = `Tremulant${i.toString().padStart(3, '0')}`;
        let tremId = manual[tremKey];
        if (tremId !== undefined) {
          tremId = normalizeId(tremId);
          explicitlyLinkedTrems.add(tremId);
          const trem = organData.tremulants[tremId];
          if (trem) {
            trem.manualId = manualId;
            const tremName = trem.name;
            const stopId = `TREM_${tremId}`;
            organData.stops[stopId] = {
              id: stopId,
              name: tremName,
              rankIds: [],
              manualId,
              volume: 100,
              gain: 0,
              displayed: true
            };
            mData.stopIds.push(stopId);
          }
        }
      }

      const numStops = parseInt(manual.NumberOfStops || '0');
      for (let i = 1; i <= numStops; i++) {
        const stopKey = `Stop${i.toString().padStart(3, '0')}`;
        let actualStopId = manual[stopKey];
        if (actualStopId !== undefined) {
          actualStopId = normalizeId(actualStopId);
          if (allStopsRaw[actualStopId]) {
            const stop = allStopsRaw[actualStopId];
            const name = stop.Name || `Stop ${actualStopId}`;
            const isNoise = NOISE_KEYWORDS.some(kw => name.toLowerCase().includes(kw));

            if (!isNoise) {
              const rankIds: string[] = [];
              for (let j = 1; j <= 20; j++) {
                const rankKey = `Rank${j.toString().padStart(3, '0')}`;
                if (stop[rankKey]) rankIds.push(normalizeId(stop[rankKey]));
              }

              const stopData: OrganStop = {
                id: actualStopId,
                name,
                rankIds,
                manualId,
                volume: 100,
                gain: parseGain(stop),
                displayed: true
              };

              organData.stops[actualStopId] = stopData;
              mData.stopIds.push(actualStopId);
            }
          }
        }
      }

      if (mData.stopIds.length > 0) {
        // Find implicit tremulants via WindchestGroup
        Object.keys(organData.ranks).forEach(rankId => {
          const rank = (organData.ranks[rankId] as any);
          const wcgId = rank.windchestGroup;
          if (wcgId && windchestTremulants[wcgId]) {
            // Check if this rank belongs to any stop in this manual
            const isRankInManual = mData.stopIds.some(stopId => {
              const stop = organData.stops[stopId];
              return stop?.rankIds.includes(rankId);
            });

            if (isRankInManual) {
              windchestTremulants[wcgId].forEach(tremId => {
                if (!explicitlyLinkedTrems.has(tremId)) {
                  explicitlyLinkedTrems.add(tremId);
                  const trem = organData.tremulants[tremId];
                  if (trem) {
                    trem.manualId = manualId;
                    const stopId = `TREM_${tremId}`;
                    if (!organData.stops[stopId]) {
                      organData.stops[stopId] = {
                        id: stopId,
                        name: trem.name,
                        rankIds: [],
                        manualId,
                        volume: 100,
                        gain: 0,
                        displayed: true
                      };
                    }
                    if (!mData.stopIds.includes(stopId)) {
                      mData.stopIds.push(stopId);
                      console.log(`[Parser] Linked implicit Tremulant ${tremId} to Manual ${manualId}`);
                    }
                  }
                }
              });
            }
          }
        });

        organData.manuals.push(mData);
      }
    }
  });

  // Fallback
  if (organData.manuals.length === 0) {
    Object.keys(allStopsRaw).forEach(stopId => {
      const stop = allStopsRaw[stopId];
      const name = stop.Name || `Stop ${stopId}`;
      const isNoise = NOISE_KEYWORDS.some(kw => name.toLowerCase().includes(kw));
      if (!isNoise) {
        const manualId = normalizeId(stop.Manual || '001');
        const rankIds: string[] = [];
        for (let j = 1; j <= 20; j++) {
          const rankKey = `Rank${j.toString().padStart(3, '0')}`;
          if (stop[rankKey]) rankIds.push(normalizeId(stop[rankKey]));
        }

        organData.stops[stopId] = {
          id: stopId,
          name,
          rankIds,
          manualId,
          volume: 100,
          gain: parseGain(stop),
          displayed: true
        };

        let m = organData.manuals.find(manual => manual.id === manualId);
        if (!m) {
          m = { id: manualId, name: `Manual ${manualId}`, gain: 0, stopIds: [] };
          organData.manuals.push(m);
        }
        m.stopIds.push(stopId);
      }
    });
  }

  return organData;
}
