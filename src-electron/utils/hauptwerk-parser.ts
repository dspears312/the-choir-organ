import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';
import { OrganData, OrganStop, OrganManual, OrganRank, OrganPipe, OrganTremulant, NOISE_KEYWORDS } from './odf-parser';

const GLOBAL_ATTENUATION = 14;

/**
 * Parses Hauptwerk XML organ definition files.
 * Correctly resolves sample paths across distributed Installation Packages
 * and maps the hierarchical structure to the common OrganData format.
 */
export function parseHauptwerk(filePath: string): OrganData {
    console.log(`[HauptwerkParser] Starting parse for: ${filePath}`);
    const xmlData = fs.readFileSync(filePath, 'utf-8');
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
        parseTagValue: true,
        trimValues: true,
    });
    const parsed = parser.parse(xmlData);

    const getObjectList = (type: string) => {
        const list = parsed.Hauptwerk?.ObjectList?.find((l: any) => l.ObjectType === type);
        if (!list) return [];
        const result = list.o || [];
        return Array.isArray(result) ? result : [result];
    };

    // Extract General info
    const generalList = parsed.Hauptwerk?.ObjectList?.find((l: any) => l.ObjectType === '_General');
    const general = generalList?._General || (Array.isArray(generalList?.o) ? generalList.o[0] : generalList?.o);
    const organName = general?.Identification_Name || 'Unknown Hauptwerk Organ';
    const basePath = path.normalize(path.dirname(filePath));

    console.log(`[HauptwerkParser] Organ Name: ${organName}`);

    // Resolve the OrganInstallationPackages directories (multiple for distributed organs)
    const packageDirs = findRelevantPackagesDirs(basePath);
    console.log(`[HauptwerkParser] Found ${packageDirs.length} package directories.`);

    // Index all available .wav/.wv files in all identified installation packages
    const sampleIndex = new Map<string, string>();
    packageDirs.forEach(dir => {
        const index = scanInstallationPackages(dir);
        index.forEach((p, k) => sampleIndex.set(k, p));
    });
    console.log(`[HauptwerkParser] Indexed ${sampleIndex.size} sample files total.`);

    let globalGain = parseFloat(general?.AudioOut_AmplitudeLevelAdjustDecibels || general?.AmplitudeLevelAdjustDecibels || '0');
    // If the file specifies 0 (or defaults to 0), it usually means "no adjustment", 
    // but without internal engine headroom, this clips. Default to -14dB for safety.
    if (globalGain === 0) globalGain = -GLOBAL_ATTENUATION;

    const organData: OrganData = {
        name: organName,
        globalGain,
        stops: {},
        manuals: [],
        ranks: {},
        tremulants: {},
        basePath,
        sourcePath: filePath,
    };

    // 1. Divisions and Keyboards
    const divisions = getObjectList('Division');
    const keyboards = getObjectList('Keyboard');
    const divisionMap = new Map<string, OrganManual>();

    divisions.forEach((div: any) => {
        const id = div.a.toString();
        const keyboard = keyboards.find((k: any) => k.a.toString() === id);
        const name = keyboard?.b || div.b || `Division ${id}`;
        const manual: OrganManual = {
            id,
            name,
            gain: 0,
            stopIds: [],
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
            name,
            gain: 0,
            pipes: [],
        };
    });

    // 3. Samples Map (ID -> { packageID, relPath })
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

    // 4. Attack/Release Sample Sets (SetID -> SampleID)
    const attackSamples = getObjectList('Pipe_SoundEngine01_AttackSample');
    const releaseSamples = getObjectList('Pipe_SoundEngine01_ReleaseSample');

    // SetID -> first SampleID found
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

    // 5. Layers (PipeID -> SetIDs)
    const layers = getObjectList('Pipe_SoundEngine01_Layer');
    const pipeIDToLayerSets = new Map<string, { attack?: string; release?: string }>();
    layers.forEach((l: any) => {
        const pipeID = l.b?.toString();
        const layerID = l.a?.toString();
        if (pipeID && layerID) {
            if (!pipeIDToLayerSets.has(pipeID)) {
                // For simplicity, take the first layer as the primary sound source
                const attackSetID = layerID;
                const releaseSetID = layerID;
                pipeIDToLayerSets.set(pipeID, { attack: attackSetID, release: releaseSetID });
            }
        }
    });

    // 6. Pipes (SoundEngine01)
    const enginePipes = getObjectList('Pipe_SoundEngine01');
    let resolvedCount = 0;
    let fallbackCount = 0;

    enginePipes.forEach((p: any) => {
        const pipeID = p.a.toString();
        const rankID = p.b.toString();
        let midiNote = parseInt(p.d);

        if (isNaN(midiNote)) {
            // Fallback: If 'd' is missing, some ODFs might map differently,
            // but falling back to 'c' (AttackSampleID) is dangerous if it's non-numeric.
            // Check if 'c' looks like a reasonable note (0-127) before using it.
            const candidate = parseInt(p.c);
            if (!isNaN(candidate) && candidate >= 0 && candidate <= 128) {
                midiNote = candidate;
            } else {
                console.warn(`[HauptwerkParser] Pipe ${pipeID} (Rank ${rankID}) has invalid/missing MIDI Note (d=${p.d}). Formatted as NaN.`);
                midiNote = NaN; // Let it be NaN so we can filter or debug, rather than a random SampleID
            }
        }

        const harmonicNumber = parseInt(p.f || '8'); // Hauptwerk uses 'f' for harmonic/footage mapping (where 8 = 8')

        if (!organData.ranks[rankID]) return;

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

        // Fallback: common naming convention lookup
        if (!attackSampleID) {
            attackSampleID = setIDToAttackSample.get(pipeID + '0');
        }

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

            // Last resort: relative to ODF (only if index search failed)
            return path.resolve(basePath, info.relPath);
        };

        const wavPath = resolvePath(attackSampleID) || '';
        const relPathStr = resolvePath(releaseSampleID);

        if (wavPath && fs.existsSync(wavPath)) {
            resolvedCount++;
        } else if (wavPath) {
            fallbackCount++;
            if (fallbackCount < 5) console.log(`[HauptwerkParser] Failed to find sample at: ${wavPath}`);
        }

        organData.ranks[rankID].pipes.push({
            pitch: midiNote.toString(),
            wavPath,
            releasePath: relPathStr,
            midiNote,
            // 'p' is Gain (likely AudioOut_AmplitudeLevelAdjustDecibels)
            // 'n' is Stereo Pan
            gain: .5, //parseFloat(p.p || p.AmplitudeLevelAdjustDecibels || '0') - GLOBAL_ATTENUATION,
            pan: parseFloat(p.n || p.Pan || '0'),
            tuning: 0,
            harmonicNumber,
        });
    });

    console.log(`[HauptwerkParser] Resolved ${resolvedCount} pipes successfully. ${fallbackCount} used fallbacks/missing.`);

    // 7. Stops and StopRank mapping
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

        const isNoise = NOISE_KEYWORDS.some(kw => name.toLowerCase().includes(kw));
        if (isNoise) return;

        const rankIds = stopToRanks.get(id) || [];
        if (rankIds.length === 0) return;

        const stopData: OrganStop = {
            id,
            name,
            rankIds,
            manualId: divisionID || '1',
            volume: 100,
            gain: 0,
            displayed: true,
        };

        organData.stops[id] = stopData;
        const manual = divisionMap.get(divisionID);
        if (manual) {
            manual.stopIds.push(id);
        } else if (organData.manuals.length > 0) {
            const firstManual = organData.manuals[0];
            if (firstManual) firstManual.stopIds.push(id);
        }
    });

    return organData;
}

/**
 * Searches upward to find the 'OrganInstallationPackages' folder,
 * and if it's within the 'extracted_organs' root, scans all sibling extractions too.
 */
function findRelevantPackagesDirs(startDir: string): string[] {
    const results: string[] = [];
    let current = path.resolve(startDir);
    let primaryPkgDir: string | null = null;
    let extractionRoot: string | null = null;

    // 1. Find the primary package dir for THIS extraction
    for (let i = 0; i < 6; i++) {
        const check = path.join(current, 'OrganInstallationPackages');
        if (fs.existsSync(check) && fs.statSync(check).isDirectory()) {
            primaryPkgDir = check;
            // The shell of the extraction is current
            // If its parent is 'extracted_organs', we can find siblings
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

    // 2. Discover sibling packages if we found the root
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

/**
 * Recursively scans all subdirectories of 'OrganInstallationPackages' to build a lookup index.
 */
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
                    // Index by relative path and by packageID/relative-path
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

/**
 * Helper for recursive file walking.
 */
function walk(dir: string, callback: (filePath: string) => void) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walk(fullPath, callback);
        } else if (stat.isFile()) {
            const lowerFile = file.toLowerCase();
            // Accept both wav and wv (lossless compression) formats
            if (lowerFile.endsWith('.wav') || lowerFile.endsWith('.wv')) {
                callback(fullPath);
            }
        }
    }
}
