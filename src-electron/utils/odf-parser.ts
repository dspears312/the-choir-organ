import ini from 'ini';
import fs from 'fs';
import path from 'path';
import {
  OrganModel, GenericPipe, GenericRank, GenericStop, GenericManual,
  GenericCoupler, GenericTremulant, GenericEnclosure, GenericWindchest
} from '../../src/types/organ-model';

// Re-export for compatibility with consumers expecting old names
export type OrganData = OrganModel;
export type OrganPipe = GenericPipe;
export type OrganRank = GenericRank;
export type OrganStop = GenericStop;
export type OrganManual = GenericManual;
export type OrganTremulant = GenericTremulant;

export const NOISE_KEYWORDS = ['noise', 'tracker', 'blower', 'motor', 'action', 'vental', 'tremulant noise', 'drawknob', 'stop action', 'special'];

function normalizeId(id: string | number): string {
  if (typeof id === 'number') return id.toString().padStart(3, '0');
  const s = id.toString().trim();
  if (/^\d+$/.test(s)) return s.padStart(3, '0');
  return s;
}

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

// Case-insensitive getter
function getProp(sec: any, key: string): string | undefined {
  if (!sec) return undefined;
  if (sec[key] !== undefined) return sec[key];
  const lower = key.toLowerCase();
  const realKey = Object.keys(sec).find(k => k.toLowerCase() === lower);
  return realKey ? sec[realKey] : undefined;
}

function parseGain(section: any, prefix: string = ''): number {
  let g = 0;
  // Explicit Gain (dB)
  const gainStr = getProp(section, prefix + 'Gain');
  if (gainStr !== undefined) {
    g += parseFloat(gainStr);
  }

  // Amplitude (Linear 0-100 or specific scale)
  // GO Spec: "100 means no change". So 20*log10(val/100).
  const ampStr = getProp(section, prefix + 'AmplitudeLevel') || getProp(section, prefix + 'Amplitude');
  if (ampStr !== undefined) {
    const amp = parseFloat(ampStr);
    if (amp > 0) {
      g += 20 * Math.log10(amp / 100);
    }
  }
  return isNaN(g) ? 0 : g;
}

function parseTuning(section: any, prefix: string = ''): number {
  let t = 0;
  const tuningStr = getProp(section, prefix + 'PitchTuning');
  if (tuningStr) t += parseFloat(tuningStr);

  const correctionStr = getProp(section, prefix + 'PitchCorrection');
  if (correctionStr) t += parseFloat(correctionStr);

  return isNaN(t) ? 0 : t;
}

export function parseODF(filePath: string): OrganModel {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/#/g, '§SHARP§');
  let parsed = ini.parse(content);
  parsed = restoreSharps(parsed);

  const basePath = path.dirname(filePath);

  // -- 1. Initialize Model --
  const model: OrganModel = {
    name: parsed.Organ?.Name || parsed.Organ?.['Organ Info'] || 'Unknown Organ',
    basePath,
    manuals: [],
    stops: {},
    couplers: {},
    ranks: {},
    tremulants: {},
    enclosures: {},
    windchests: {},
    screens: [],
    globalGain: parseGain(parsed.Organ || {})
  };

  // -- 2. Parse Enclosures --
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Enclosure')) {
      const id = normalizeId(key.replace('Enclosure', ''));
      const sec = parsed[key];
      model.enclosures[id] = {
        id,
        name: sec.Name || `Enclosure ${id}`,
        ampMinimumLevel: parseFloat(sec.AmpMinimumLevel || '0'),
        midiInputNumber: parseInt(sec.MIDIInputNumber || '0'),
        currValue: 0,
        displayed: sec.Displayed !== 'N'
      };
    }
  });

  // -- 3. Parse Tremulants --
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Tremulant')) {
      const id = normalizeId(key.replace('Tremulant', ''));
      const sec = parsed[key];
      model.tremulants[id] = {
        id,
        name: sec.Name || `Tremulant ${id}`,
        type: sec.TremulantType === 'Wave' ? 'Wave' : 'Synth',
        period: parseFloat(sec.Period || '200'),
        ampModDepth: parseFloat(sec.AmpModDepth || '0'),
        pitchModDepth: parseFloat(sec.PitchModDepth || '0'),
        startRate: parseFloat(sec.StartRate || '1'),
        stopRate: parseFloat(sec.StopRate || '1'),
      };
    }
  });

  // -- 4. Parse Windchests --
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Windchest') && !key.startsWith('WindchestGroup')) {
      const id = normalizeId(key.replace('Windchest', ''));
      const sec = parsed[key];

      const tremIds: string[] = [];
      const numTrems = parseInt(sec.NumberOfTremulants || '0');
      for (let i = 1; i <= numTrems; i++) {
        const t = sec[`Tremulant${i.toString().padStart(3, '0')}`];
        if (t) tremIds.push(normalizeId(t));
      }

      const encIds: string[] = [];
      const numEncs = parseInt(sec.NumberOfEnclosures || '0');
      for (let i = 1; i <= numEncs; i++) {
        const e = sec[`Enclosure${i.toString().padStart(3, '0')}`];
        if (e) encIds.push(normalizeId(e));
      }

      model.windchests[id] = {
        id,
        name: sec.Name || `Windchest ${id}`,
        gain: parseGain(sec),
        tuning: parseTuning(sec),
        enclosureIds: encIds,
        tremulantIds: tremIds,
        trackerDelay: parseInt(sec.TrackerDelay || '0')
      };
    }
    if (key.startsWith('WindchestGroup')) {
      const id = normalizeId(key.replace('WindchestGroup', ''));
      if (!model.windchests[id]) {
        const sec = parsed[key];
        const tremIds: string[] = [];
        const numTrems = parseInt(sec.NumberOfTremulants || '0');
        for (let i = 1; i <= numTrems; i++) {
          const t = sec[`Tremulant${i.toString().padStart(3, '0')}`];
          if (t) tremIds.push(normalizeId(t));
        }
        model.windchests[id] = {
          id,
          name: sec.Name || `Windchest ${id}`,
          gain: 0,
          tuning: 0,
          enclosureIds: [],
          tremulantIds: tremIds,
          trackerDelay: 0
        };
      }
    }
  });

  // -- 5. Parse Ranks & Pipes --
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Rank')) {
      const rankId = normalizeId(key.replace('Rank', ''));
      const sec = parsed[key];

      const wcId = normalizeId(sec.WindchestGroup || sec.Windchest || '001');
      const wc = model.windchests[wcId];

      const rankGain = parseGain(sec) + (wc?.gain || 0);
      const rankTuning = parseTuning(sec) + (wc?.tuning || 0);
      const rankDelay = parseInt(sec.TrackerDelay || '0') + (wc?.trackerDelay || 0);
      const rankHarmonic = parseFloat(sec.HarmonicNumber || '8');

      const pipes: Record<number, GenericPipe> = {};
      const firstMidi = parseInt(sec.FirstMidiNoteNumber || '36');
      const numPipes = parseInt(sec.NumberOfLogicalPipes || '61'); // fallback

      for (let i = 1; i <= 192; i++) {
        const pipeKey = `Pipe${i.toString().padStart(3, '0')}`;

        let rawPath = sec[pipeKey];
        if (!rawPath) continue;

        rawPath = rawPath.toString();
        if (rawPath.toUpperCase() === 'DUMMY' || rawPath === '' || rawPath === '0') continue;

        const pipeGain = parseGain(sec, pipeKey) + rankGain;
        const pipeTuning = parseTuning(sec, pipeKey) + rankTuning;

        const pipeDelay = parseInt(getProp(sec, pipeKey + 'TrackerDelay') || '0') + rankDelay;
        const pipeHarmonic = parseFloat(getProp(sec, pipeKey + 'HarmonicNumber') || rankHarmonic.toString());
        const midiNote = parseInt(getProp(sec, pipeKey + 'MIDIKeyNumber') || ((firstMidi - 1) + i).toString());

        let releasePathStr = sec[pipeKey + 'Release001'];
        let releasePath: string | undefined;
        if (releasePathStr && releasePathStr !== '0' && !releasePathStr.toUpperCase().includes('DUMMY')) {
          releasePath = path.resolve(basePath, releasePathStr.replace(/\\/g, '/'));
        }

        pipes[midiNote] = {
          id: `${rankId}_${i}`,
          midiNote,
          wavPath: path.resolve(basePath, rawPath.replace(/\\/g, '/')),
          gain: pipeGain,
          tuning: pipeTuning,
          trackerDelay: pipeDelay,
          harmonicNumber: pipeHarmonic,
          releasePath,
          isPercussive: (sec.Percussive === 'Y' || sec.Percussive === 'true')
        };
      }

      model.ranks[rankId] = {
        id: rankId,
        name: sec.Name || `Rank ${rankId}`,
        pipes,
        gain: rankGain,
        windchestId: wcId
      };
    }
  });

  // -- 6. Parse Stops & Couplers --
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Stop')) {
      const id = normalizeId(key.replace('Stop', ''));
      const sec = parsed[key];
      const name = sec.Name || `Stop ${id}`;

      if (NOISE_KEYWORDS.some(kw => name.toLowerCase().includes(kw))) return;

      const rankIds: string[] = [];
      const numRanks = parseInt(sec.NumberOfRanks || '0');
      if (numRanks > 0) {
        for (let i = 1; i <= numRanks; i++) {
          const rKey = `Rank${i.toString().padStart(3, '0')}`;
          if (sec[rKey]) rankIds.push(normalizeId(sec[rKey]));
        }
      } else {
        if (sec['Pipe001']) {
          const rankId = `IMP_${id}`;
          console.warn(`[Parser] Implicit rank in Stop ${id} not fully supported yet.`);
        }
      }

      if (rankIds.length === 0) {
        for (let i = 1; i <= 50; i++) {
          const rKey = `Rank${i.toString().padStart(3, '0')}`;
          if (sec[rKey]) rankIds.push(normalizeId(sec[rKey]));
        }
      }

      model.stops[id] = {
        id,
        name,
        manualId: normalizeId(sec.Manual || '001'),
        rankIds,
        gain: parseGain(sec),
        pitchShift: 0,
        displayed: sec.Displayed !== 'N'
      };
    }
  });

  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Coupler')) {
      const id = normalizeId(key.replace('Coupler', ''));
      const sec = parsed[key];
      const name = sec.Name || `Coupler ${id}`;

      model.couplers[id] = {
        id,
        name,
        manualId: '000',
        destinationManualId: normalizeId(sec.DestinationManual || '000'),
        keyShift: parseInt(sec.DestinationKeyshift || '0'),
        couplingType: sec.UnisonOff === 'Y' ? 'UnisonOff' : (sec.CouplerType || 'Normal'),
        coupleToSubsequentUnison: sec.CoupleToSubsequentUnisonIntermanualCouplers !== 'N',
        coupleToSubsequentUpward: sec.CoupleToSubsequentUpwardIntermanualCouplers !== 'N',
        coupleToSubsequentDownward: sec.CoupleToSubsequentDownwardIntermanualCouplers !== 'N'
      };
    }
  });

  // -- 7. Parse Manuals --
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Manual')) {
      const id = normalizeId(key.replace('Manual', ''));
      const sec = parsed[key];

      const stopIds: string[] = [];
      const numStops = parseInt(sec.NumberOfStops || '0');
      for (let i = 1; i <= numStops; i++) {
        const s = sec[`Stop${i.toString().padStart(3, '0')}`];
        if (s) stopIds.push(normalizeId(s));
      }

      stopIds.forEach(sid => {
        if (model.stops[sid]) model.stops[sid].manualId = id;
      });

      if (stopIds.length === 0) {
        for (let i = 1; i <= 99; i++) {
          const s = sec[`Stop${i.toString().padStart(3, '0')}`];
          if (s) {
            const sId = normalizeId(s);
            stopIds.push(sId);
            if (model.stops[sId]) model.stops[sId].manualId = id;
          }
        }
      }

      const couplerIds: string[] = [];
      const numCouplers = parseInt(sec.NumberOfCouplers || '0');
      for (let i = 1; i <= numCouplers; i++) {
        const c = sec[`Coupler${i.toString().padStart(3, '0')}`];
        if (c) {
          const cId = normalizeId(c);
          couplerIds.push(cId);
          if (model.couplers[cId]) model.couplers[cId].manualId = id;
        }
      }

      const tremulantIds: string[] = [];
      const numTremulants = parseInt(sec.NumberOfTremulants || '0');
      for (let i = 1; i <= numTremulants; i++) {
        const t = sec[`Tremulant${i.toString().padStart(3, '0')}`];
        if (t) {
          const tId = normalizeId(t);
          tremulantIds.push(tId);
        }
      }

      model.manuals.push({
        id,
        name: sec.Name || `Manual ${id}`,
        gain: parseGain(sec),
        firstKey: parseInt(sec.FirstAccessibleKeyMIDINoteNumber || '36'),
        lastKey: parseInt(sec.FirstAccessibleKeyMIDINoteNumber || '36') + parseInt(sec.NumberOfAccessibleKeys || '61') - 1,
        stopIds,
        couplerIds,
        tremulantIds,
        displayed: sec.Displayed !== 'N'
      });
    }
  });

  // -- 8. Legacy Screen Parsing (Partial) --
  const switchIdToStopId: Record<string, string> = {}; // Rebuild minimal mapping if needed for UI, or skip.
  // To enable "Switch" clickable on screen, we need to map Switch ID -> Stop/Coupler ID.
  // Re-scanning stops for this mapping:
  Object.keys(parsed).forEach(key => {
    if (key.startsWith('Stop')) {
      const stopId = normalizeId(key.replace('Stop', ''));
      const numSwitches = parseInt(parsed[key].SwitchCount || '1');
      for (let i = 1; i <= numSwitches; i++) {
        const sw = parsed[key][`Switch${i.toString().padStart(3, '0')}`];
        if (sw) switchIdToStopId[normalizeId(sw)] = stopId;
      }
    }
    // Couplers too
    if (key.startsWith('Coupler')) {
      const coupId = normalizeId(key.replace('Coupler', ''));
      const numSwitches = parseInt(parsed[key].SwitchCount || '1');
      for (let i = 1; i <= numSwitches; i++) {
        const sw = parsed[key][`Switch${i.toString().padStart(3, '0')}`];
        if (sw) switchIdToStopId[normalizeId(sw)] = coupId;
      }
    }
  });

  // Parse Main Screen
  if (parsed.Organ?.DispScreenSizeHoriz) {
    const screenId = 'Main';
    const elements: any[] = []; // OrganScreenElement[]

    // 1. Parsing Images (Static Backgrounds / Labels)
    const numImages = parseInt(parsed.Organ.NumberOfImages || '0');
    for (let i = 1; i <= numImages; i++) {
      const key = `Image${i.toString().padStart(3, '0')}`;
      const sec = parsed[key];
      if (!sec) continue;

      if (sec.Image) {
        elements.push({
          id: `img_${i}`,
          type: 'Image',
          name: 'Image',
          x: parseInt(sec.PositionX || '0'),
          y: parseInt(sec.PositionY || '0'),
          width: 0, // Auto
          height: 0,
          zIndex: 1, // Backgrounds lower
          imageOff: path.resolve(basePath, sec.Image.replace(/\\/g, '/'))
        });
      }
    }

    // 2. Parsing Switches (Interactive Controls)
    // We need to know which Switch ID maps to which Stop/Coupler/Tremulant
    // Re-scanning Tremulants for mapping as well
    Object.keys(parsed).forEach(key => {
      if (key.startsWith('Tremulant')) {
        const tremId = normalizeId(key.replace('Tremulant', ''));
        const numSwitches = parseInt(parsed[key].SwitchCount || '1');
        for (let i = 1; i <= numSwitches; i++) {
          const sw = parsed[key][`Switch${i.toString().padStart(3, '0')}`];
          if (sw) switchIdToStopId[normalizeId(sw)] = `TREM_${tremId}`;
        }
      }
    });

    const numSwitches = parseInt(parsed.Organ.NumberOfSwitches || '0');
    for (let i = 1; i <= numSwitches; i++) {
      const swId = i.toString().padStart(3, '0');
      const key = `Switch${swId}`;
      const sec = parsed[key];
      if (!sec) continue;

      // Resolution of Link ID
      // The ODF structure is inverted: Components list their SwitchIDs.
      // We built switchIdToStopId map earlier.
      const linkId = switchIdToStopId[swId];

      if (sec.ImageOn || sec.ImageOff) {
        elements.push({
          id: `sw_${swId}`,
          type: 'Switch',
          name: 'Switch',
          x: parseInt(sec.PositionX || '0'),
          y: parseInt(sec.PositionY || '0'),
          width: 0,
          height: 0,
          zIndex: 10,
          linkId, // Might be undefined -> decorative switch?
          imageOn: sec.ImageOn ? path.resolve(basePath, sec.ImageOn.replace(/\\/g, '/')) : undefined,
          imageOff: sec.ImageOff ? path.resolve(basePath, sec.ImageOff.replace(/\\/g, '/')) : undefined,
        });
      }
    }

    model.screens.push({
      id: screenId,
      name: 'Console',
      width: parseInt(parsed.Organ.DispScreenSizeHoriz),
      height: parseInt(parsed.Organ.DispScreenSizeVert),
      elements: elements
    });

    // Set background image from first image if available (Legacy/Fallback behavior)
    if (elements.length > 0 && elements[0].type === 'Image') {
      model.screens[0].backgroundImage = elements[0].imageOff;
    }
  }

  return model;
}

