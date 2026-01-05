import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';
import {
    OrganModel, GenericStop, GenericManual, GenericRank, GenericPipe,
    GenericTremulant, GenericEnclosure, GenericWindchest, GenericCoupler
} from '../../src/types/organ-model';
import { NOISE_KEYWORDS } from './odf-parser';

const GLOBAL_ATTENUATION = 14;

export function parseHauptwerk(filePath: string): OrganModel {
    console.log(`[HauptwerkParser] Starting parse for: ${filePath}`);
    const xmlData = fs.readFileSync(filePath, 'utf-8');
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        isArray: (name) => ['o', 'ObjectList', '_General', 'DisplayPage', 'ImageSet', 'ImageSetElement', 'ImageSetInstance', 'Switch'].includes(name)
    });
    const parsed = parser.parse(xmlData);

    const getObjectList = (type: string) => {
        const allLists = Array.isArray(parsed.Hauptwerk?.ObjectList) ? parsed.Hauptwerk.ObjectList : [parsed.Hauptwerk?.ObjectList].filter(Boolean);
        const lists = allLists.filter((l: any) => l.ObjectType === type || l.ObjectType === `_${type}`);
        const results: any[] = [];
        lists.forEach((list: any) => {
            const items = list.o || list[type] || list[`_${type}`] || [];
            if (Array.isArray(items)) {
                results.push(...items);
            } else {
                results.push(items);
            }
        });
        return results;
    };

    const general = getObjectList('General')[0];
    const organName = general?.Identification_Name || 'Unknown Hauptwerk Organ';
    const basePath = path.normalize(path.dirname(filePath));

    console.log(`[HauptwerkParser] Organ Name: ${organName}`);

    const packageDirs = findRelevantPackagesDirs(basePath);
    console.log(`[HauptwerkParser] Found ${packageDirs.length} package directories.`);

    const sampleIndex = new Map<string, string>();
    packageDirs.forEach(dir => {
        const index = scanInstallationPackages(dir);
        index.forEach((p, k) => sampleIndex.set(k, p));
    });
    console.log(`[HauptwerkParser] Indexed ${sampleIndex.size} sample files total.`);

    let globalGain = parseFloat(general?.AudioOut_AmplitudeLevelAdjustDecibels || general?.AmplitudeLevelAdjustDecibels || '0');
    if (globalGain === 0) globalGain = -GLOBAL_ATTENUATION;

    const organData: OrganModel = {
        name: organName,
        globalGain,
        stops: {},
        manuals: [],
        ranks: {},
        tremulants: {},
        enclosures: {},
        windchests: {},
        couplers: {},
        screens: [],
        basePath
    };

    // 1. Divisions and Keyboards
    const appDivisions = getObjectList('Division') || []; // Fallback empty
    const keyboards = getObjectList('Keyboard') || [];
    const divisionMap = new Map<string, GenericManual>();

    keyboards.forEach((k: any) => {
        const id = k.a.toString();
        const name = k.b || `Manual ${id}`;

        const manual: GenericManual = {
            id,
            name,
            gain: 0,
            stopIds: [],
            couplerIds: [],
            tremulantIds: [],
            firstKey: 36, // Start C
            lastKey: 96,  // Fallback
            displayed: true
        };
        organData.manuals.push(manual);
        divisionMap.set(id, manual);
    });

    // 2. Ranks
    const ranks = getObjectList('Rank');
    ranks.forEach((rankObj: any) => {
        const id = rankObj.a.toString();
        const name = rankObj.b || `Rank ${id}`;

        const isNoise = NOISE_KEYWORDS.some(kw => name.toLowerCase().includes(kw));
        if (isNoise) return;

        organData.ranks[id] = {
            id,
            name,
            gain: 0,
            pipes: {},
            windchestId: '001'
        };
    });

    // 3. Samples Map
    const samples = getObjectList('Sample');
    const sampleMap = new Map<string, { packageID?: string; relPath: string }>();
    samples.forEach((s: any) => {
        if (s.a && s.c) {
            sampleMap.set(s.a.toString(), {
                packageID: s.b?.toString(),
                relPath: s.c.replace(/\\/g, '/'),
            });
        }
    });

    // 4. Attack/Release Sets
    const attackSamples = getObjectList('Pipe_SoundEngine01_AttackSample');
    const releaseSamples = getObjectList('Pipe_SoundEngine01_ReleaseSample');

    const setIDToAttackSample = new Map<string, string>();
    const setIDToReleaseSample = new Map<string, string>();

    attackSamples.forEach((s: any) => {
        const setID = s.b?.toString();
        const sampleID = s.c?.toString() || s.a?.toString();
        if (setID && sampleID && !setIDToAttackSample.has(setID)) {
            setIDToAttackSample.set(setID, sampleID);
        }
    });

    releaseSamples.forEach((s: any) => {
        const setID = s.b?.toString();
        const sampleID = s.c?.toString() || s.a?.toString();
        if (setID && sampleID && !setIDToReleaseSample.has(setID)) {
            setIDToReleaseSample.set(setID, sampleID);
        }
    });

    // 5. Layers
    const layers = getObjectList('Pipe_SoundEngine01_Layer');
    const pipeIDToLayerSets = new Map<string, { attack?: string; release?: string }>();
    layers.forEach((l: any) => {
        const pipeID = l.b?.toString();
        const layerID = l.a?.toString();
        if (pipeID && layerID) {
            if (!pipeIDToLayerSets.has(pipeID)) {
                pipeIDToLayerSets.set(pipeID, { attack: layerID, release: layerID });
            }
        }
    });

    const resolvePath = (sampleID: string | undefined): string | undefined => {
        if (!sampleID) return undefined;
        const info = sampleMap.get(sampleID);
        if (!info) return undefined;

        if (info.packageID) {
            const pkgIDNormalized = info.packageID.padStart(6, '0');
            const pkgKey = `${pkgIDNormalized}/${info.relPath.toLowerCase()}`;
            if (sampleIndex.has(pkgKey)) return sampleIndex.get(pkgKey);
        }

        const relKey = info.relPath.toLowerCase();
        const indexedPath = sampleIndex.get(relKey);
        if (indexedPath) return indexedPath;

        return path.resolve(basePath, info.relPath);
    };

    // 6. Pipes
    const enginePipes = getObjectList('Pipe_SoundEngine01');
    enginePipes.forEach((p: any) => {
        const pipeID = p.a.toString();
        const rankID = p.b.toString();
        let midiNote = parseInt(p.d);

        if (isNaN(midiNote)) {
            const candidate = parseInt(p.c);
            if (!isNaN(candidate) && candidate >= 0 && candidate <= 128) {
                midiNote = candidate;
            } else {
                midiNote = NaN;
            }
        }

        if (isNaN(midiNote)) return;

        const rankData = organData.ranks[rankID];
        if (!rankData) return;

        let attackSampleID: string | undefined;
        let releaseSampleID: string | undefined;

        if (p.c) attackSampleID = setIDToAttackSample.get(p.c.toString());

        const layerSets = pipeIDToLayerSets.get(pipeID);
        if (!attackSampleID && layerSets?.attack) {
            attackSampleID = setIDToAttackSample.get(layerSets.attack);
        }
        if (!releaseSampleID && layerSets?.release) {
            releaseSampleID = setIDToReleaseSample.get(layerSets.release);
        }

        const wavPath = resolvePath(attackSampleID) || '';
        const relPathStr = resolvePath(releaseSampleID);

        rankData.pipes[midiNote] = {
            id: `${rankID}_${midiNote}`,
            midiNote,
            wavPath,
            releasePath: relPathStr,
            gain: 0,
            tuning: 0,
            harmonicNumber: parseFloat(p.f || '8'),
            trackerDelay: 0,
            isPercussive: false
        };
    });

    // 7. Stops and Linkages
    const stops = getObjectList('Stop');
    const stopRankLinks = getObjectList('StopRank');
    const stopToRanks = new Map<string, string[]>();

    stopRankLinks.forEach((link: any) => {
        const stopID = link.a.toString();
        const rankID = link.d.toString();
        if (stopID && rankID && organData.ranks[rankID]) {
            if (!stopToRanks.has(stopID)) stopToRanks.set(stopID, []);
            stopToRanks.get(stopID)!.push(rankID);
        }
    });

    stops.forEach((s: any) => {
        const id = s.a.toString();
        const name = s.b || `Stop ${id}`;
        const divisionID = s.c?.toString();

        if (NOISE_KEYWORDS.some(kw => name.toLowerCase().includes(kw))) return;

        const rankIds = stopToRanks.get(id) || [];
        if (rankIds.length === 0) return;

        organData.stops[id] = {
            id,
            name,
            rankIds,
            manualId: divisionID || '1',
            gain: 0,
            pitchShift: 0, // Fallback
            displayed: true
        };

        const manual = divisionMap.get(divisionID);
        if (manual) {
            manual.stopIds.push(id);
        } else if (organData.manuals.length > 0) {
            organData.manuals[0].stopIds.push(id);
        }
    });

    return organData;
}

function findRelevantPackagesDirs(startDir: string): string[] {
    const results: string[] = [];
    let current = path.resolve(startDir);
    let primaryPkgDir: string | null = null;
    let extractionRoot: string | null = null;

    for (let i = 0; i < 6; i++) {
        const check = path.join(current, 'OrganInstallationPackages');
        if (fs.existsSync(check) && fs.statSync(check).isDirectory()) {
            primaryPkgDir = check;
            const parent = path.dirname(current);
            if (path.basename(parent) === 'extracted_organs' || path.basename(parent) === 'userData') {
                extractionRoot = parent;
            }
            break;
        }
        const next = path.dirname(current);
        if (next === current) break;
        current = next;
    }

    if (primaryPkgDir) results.push(primaryPkgDir);

    if (extractionRoot) {
        try {
            const siblings = fs.readdirSync(extractionRoot, { withFileTypes: true });
            for (const sibling of siblings) {
                if (sibling.isDirectory()) {
                    const siblingPkgDir = path.join(extractionRoot, sibling.name, 'OrganInstallationPackages');
                    if (fs.existsSync(siblingPkgDir) && siblingPkgDir !== primaryPkgDir) {
                        results.push(siblingPkgDir);
                    }
                }
            }
        } catch (e) {
            console.error('[HauptwerkParser] Error scanning sibling packages:', e);
        }
    }

    return results;
}

function scanInstallationPackages(packagesDir: string): Map<string, string> {
    const fileMap = new Map<string, string>();
    try {
        const packages = fs.readdirSync(packagesDir);
        for (const pkgName of packages) {
            const pkgPath = path.join(packagesDir, pkgName);
            if (fs.statSync(pkgPath).isDirectory()) {
                const pkgID = pkgName.toLowerCase();
                walk(pkgPath, (filePath) => {
                    const relPath = path.relative(pkgPath, filePath).replace(/\\/g, '/');
                    const relPathLower = relPath.toLowerCase();
                    fileMap.set(relPathLower, filePath);
                    fileMap.set(`${pkgID}/${relPathLower}`, filePath);
                });
            }
        }
    } catch (e) {
        console.error('[HauptwerkParser] Error scanning installation packages:', e);
    }
    return fileMap;
}

function walk(dir: string, callback: (filePath: string) => void) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walk(fullPath, callback);
        } else if (stat.isFile()) {
            const lowerFile = file.toLowerCase();
            if (lowerFile.endsWith('.wav') || lowerFile.endsWith('.wv') ||
                lowerFile.endsWith('.bmp') || lowerFile.endsWith('.png') || lowerFile.endsWith('.jpg')) {
                callback(fullPath);
            }
        }
    }
}
