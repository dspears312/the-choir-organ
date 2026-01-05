import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';
import { OrganData, OrganStop, OrganManual, OrganRank, OrganPipe, OrganTremulant, NOISE_KEYWORDS, OrganScreenData, OrganScreenElement } from './odf-parser';
import { getImageDimensions } from './image-reader';

const GLOBAL_ATTENUATION = 14;

/**
 * Parses Hauptwerk XML organ definition files.
 * Correctly resolves sample paths across distributed Installation Packages
 * and maps the hierarchical structure to the common OrganData format.
 */
export function parseHauptwerk(filePath: string): OrganData {
    console.log(`[HauptwerkParser] Starting parse for: ${filePath}`);
    console.log(`[HauptwerkParser] TIMESTAMP: ${new Date().toISOString()}`);
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
            // Some lists use <o>, some use <TypeName> or <_TypeName>
            const items = list.o || list[type] || list[`_${type}`] || [];
            if (Array.isArray(items)) {
                results.push(...items);
            } else {
                results.push(items);
            }
        });
        return results;
    };

    // Extract General info
    const general = getObjectList('General')[0];
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
        screens: [],
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
            id,
            name,
            gain: 0,
            pipes: [],
            stopIds: []
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

    const resolveImagePath = (pathOrID: string | undefined): string | undefined => {
        if (!pathOrID) return undefined;
        // If it's a sample ID (numeric), resolve via sampleMap
        if (/^\d+$/.test(pathOrID)) {
            return resolvePath(pathOrID);
        }
        // Otherwise, it's a relative path
        const relPath = pathOrID.replace(/\\/g, '/');
        const relPathLower = relPath.toLowerCase();

        // 1. Check if it exists in any package via the index
        const indexedPath = sampleIndex.get(relPathLower);
        if (indexedPath) return indexedPath;

        // 2. Check if it's explicitly indexed with a package ID (if we had one, but for raw paths we don't always)
        // However, the walk function indexes everything by its lowercased relative path already.

        // 3. Last resort: check the base path (relative to the organ definition)
        return path.resolve(basePath, relPath);
    };

    // 0a. Display Pages (Screens)
    const displayPages = getObjectList('DisplayPage');
    const imageSets = getObjectList('ImageSet');
    const imageSetInstances = getObjectList('ImageSetInstance');
    const imageSetElements = getObjectList('ImageSetElement');
    const switches = getObjectList('Switch');
    const stopObjects = getObjectList('Stop');
    const switchLinkages = getObjectList('SwitchLinkage');

    // Linkage mapping: Switch ID -> Master Switch ID -> Stop ID
    const masterSwitchToStopId = new Map<string, string>();
    stopObjects.forEach((s: any) => {
        if (s.a && s.d) masterSwitchToStopId.set(s.d.toString(), s.a.toString());
    });

    const directLinks = new Map<string, string[]>();
    switchLinkages.forEach((sl: any) => {
        const a = sl.a?.toString();
        const b = sl.b?.toString();
        if (a && b) {
            if (!directLinks.has(a)) directLinks.set(a, []);
            directLinks.get(a)!.push(b);
        }
    });

    const switchIdToStopId = new Map<string, string>();
    const resolveStopId = (sid: string, visited = new Set<string>()): string | null => {
        if (visited.has(sid)) return null;
        visited.add(sid);

        const stopId = masterSwitchToStopId.get(sid);
        if (stopId) return stopId;

        const nextSids = directLinks.get(sid) || [];
        for (const next of nextSids) {
            const found = resolveStopId(next, visited);
            if (found) return found;
        }
        return null;
    };

    switches.forEach((sw: any) => {
        const sid = sw.a?.toString();
        if (sid) {
            const stopId = resolveStopId(sid);
            if (stopId) switchIdToStopId.set(sid, stopId);
        }
    });

    // Group ImageSets and ImageSetElements by ID to merge multi-state data

    // Group ImageSets and ImageSetElements by ID to merge multi-state data
    const imageSetMap = new Map<string, any>();

    // 1. Initial ImageSet data (contains masks/labels)
    imageSets.forEach((is: any) => {
        const id = is.a?.toString();
        if (!id) return;
        if (!imageSetMap.has(id)) {
            imageSetMap.set(id, { ...is });
        } else {
            Object.assign(imageSetMap.get(id), is);
        }
    });

    // 2. Merge ImageSetElement data (contains actual bitmap paths)
    imageSetElements.forEach((ise: any) => {
        const id = ise.a?.toString();
        if (!id) return;
        let entry = imageSetMap.get(id);
        if (!entry) {
            entry = { a: id };
            imageSetMap.set(id, entry);
        }

        const stage = parseInt(ise.b || '1');
        const imgPath = ise.d?.toString();
        if (imgPath) {
            if (stage === 1) {
                entry.imageOff = imgPath;
            } else if (stage === 2) {
                entry.imageOn = imgPath;
            } else if (!entry.imageOff) {
                entry.imageOff = imgPath;
            }
        }
    });

    displayPages.forEach((page: any) => {
        const pageID = page.a.toString();
        const screen: OrganScreenData = {
            id: pageID,
            name: page.b || `Page ${pageID}`,
            width: parseInt(general?.Display_ConsoleScreenWidthPixels || general?.Display_ConsoleScreenWidthPixels_A || '1024'), // Check both
            height: parseInt(general?.Display_ConsoleScreenHeightPixels || general?.Display_ConsoleScreenHeightPixels_A || '768'),
            alternateLayouts: [],
            elements: []
        };

        // Parse Alternate Layout Dimensions (Global)
        const layout1W = parseInt(general?.Display_AlternateConsoleScreenLayout1_WidthPixels || '0');
        const layout1H = parseInt(general?.Display_AlternateConsoleScreenLayout1_HeightPixels || '0');
        const layout2W = parseInt(general?.Display_AlternateConsoleScreenLayout2_WidthPixels || '0');
        const layout2H = parseInt(general?.Display_AlternateConsoleScreenLayout2_HeightPixels || '0');

        // Initialize layout availability based on explicit ODF flags (c=Wide, d=Tall)
        let enableLayout1 = page.c === 'Y';
        let enableLayout2 = page.d === 'Y';
        imageSetInstances.forEach((isi: any) => {
            if (isi.e?.toString() === pageID) {
                // DEBUG
                const imageSetID = isi.c?.toString();
                const imageSet = imageSetMap.get(imageSetID);
                if (imageSet) { // Check imageSet before using it for debug name
                    if (isi.a?.toString() === '1031' || isi.a?.toString() === '1035') {
                        const n = (isi.b || imageSet.b || `Image ${isi.a}`).toString();
                        const nl = n.toLowerCase();
                        const bg = nl.includes('background') || nl.includes('console') || nl.includes('jamb') || nl.includes('image optional');
                        console.log(`[Parser] Processing Element ${isi.a}. Name: '${n}'. k: ${isi.k}, q: ${isi.q}. isBG: ${bg}`);
                    }

                    // f: Layer/Z-index (Hauptwerk standard)
                    let zIndex = Math.round(parseFloat(isi.f || '1'));
                    let x = Math.round(parseFloat(isi.g || '0'));
                    let y = Math.round(parseFloat(isi.h || '0'));
                    let w = Math.round(parseFloat(isi.i || imageSet.g || '0'));
                    let h = Math.round(parseFloat(isi.j || imageSet.i || '0'));

                    // Alternate Layout Coordinates
                    // Layout 1: l (x), m (y), q (Alt ImageSet ID)
                    // Layout 2: r (x), s (y)
                    const layouts: { [index: number]: { x: number, y: number, width?: number, height?: number, imageOff?: string, imageOn?: string } } = {};

                    if (isi.l && isi.m) {
                        layouts[1] = {
                            x: Math.round(parseFloat(isi.l)),
                            y: Math.round(parseFloat(isi.m))
                        };
                    }

                    if (isi.r && isi.s) {
                        layouts[2] = {
                            x: Math.round(parseFloat(isi.r)),
                            y: Math.round(parseFloat(isi.s))
                        };
                    }

                    // Helpers
                    const elementName = (isi.b || imageSet.b || `Image ${isi.a}`).toString();
                    const nameLower = elementName.toLowerCase();
                    const isBG = nameLower.includes('background') ||
                        nameLower.includes('console') ||
                        nameLower.includes('jamb') ||
                        nameLower.includes('pozadi') ||
                        nameLower.includes('stul') ||
                        nameLower.includes('image optional') ||
                        nameLower.includes('optional image') ||
                        (w > 800 && h > 600); // Rough heuristic



                    // Resolving Alternate ImageSet (q tag or fallback to k)
                    let altLink = isi.q ? isi.q.toString() : undefined;

                    // Fallback: If no q, check k (ImageOn) BUT only for "Background-like" elements
                    // This handles cases like Element 1035 (Stops) which links to stopsW via k
                    if (!altLink && isi.k && !isi.q && isBG) {
                        altLink = isi.k.toString();
                        // console.log(`[Parser] checking k-link as fallback for ${isi.a}: ${altLink}`);
                    }

                    if (altLink) {
                        const altImageSetID = altLink;
                        const altImageSet = imageSetMap.get(altImageSetID);
                        if (altImageSet) {

                            const imgOffPath = altImageSet.imageOff ? resolveImagePath(altImageSet.imageOff.toString()) : undefined;
                            const imgOnPath = altImageSet.imageOn ? resolveImagePath(altImageSet.imageOn.toString()) : undefined;

                            // Detect Aspect Ratio to decide target layout
                            // Layout 1 = Widest (Landscape)
                            // Layout 2 = Tallest (Portrait)
                            let targetLayout = -1; // Default to None
                            let dims: any = null;

                            if (imgOffPath || imgOnPath) {
                                try {
                                    dims = getImageDimensions(imgOffPath || imgOnPath || '');
                                    if (dims) {
                                        if (dims.height > dims.width) {
                                            targetLayout = 2; // Portrait Image -> Apply to Portrait Layout
                                        } else if (dims.width > dims.height) {
                                            targetLayout = 1; // Landscape Image -> Apply to Wide Layout
                                        }

                                        if (targetLayout !== -1) {
                                            console.log(`[Parser] Element ${isi.a} (Link ${altLink}) - Image: ${path.basename(imgOffPath || imgOnPath || '')} - Dims: ${dims.width}x${dims.height} - Assigned to Layout ${targetLayout}`);
                                        }
                                    } else {
                                        // console.log(`[Parser] Element ${isi.a} (Link ${altLink}) - Could not get dims`);
                                    }
                                } catch (e) {
                                    // console.log(`[Parser] Element ${isi.a} (Link ${altLink}) - Error reading dims: ${e}`);
                                }
                            }

                            const applyToLayout = (idx: number) => {
                                if (idx === -1) return;

                                if (!layouts[idx]) layouts[idx] = { x: x, y: y }; // Fallback to Default Coords (x,y) if not defined

                                if (imgOffPath) layouts[idx].imageOff = imgOffPath;
                                if (imgOnPath) layouts[idx].imageOn = imgOnPath;

                                // If we have dimensions for this alternate image, store them too
                                if (dims) {
                                    layouts[idx].width = dims.width;
                                    layouts[idx].height = dims.height;
                                }

                                // Fallbacks
                                if (!layouts[idx].imageOff && altImageSet.j) {
                                    const p = resolveImagePath(altImageSet.j.toString());
                                    if (p) layouts[idx].imageOff = p;
                                }
                                if (!layouts[idx].imageOn && altImageSet.k) {
                                    const p = resolveImagePath(altImageSet.k.toString());
                                    if (p) layouts[idx].imageOn = p;
                                }
                                if (!layouts[idx].imageOff && altImageSet.d) {
                                    const p = resolveImagePath(altImageSet.d.toString());
                                    if (p) layouts[idx].imageOff = p;
                                }
                            };

                            // Apply to the DETECTED layout
                            applyToLayout(targetLayout);
                        }
                    }

                    const element: OrganScreenElement = {
                        id: isi.a.toString(),
                        type: 'Image',
                        name: elementName,
                        x,
                        y,
                        width: w,
                        height: h,
                        // zIndex logic handles isBG later, or can reuse here? 
                        // The original code calculated zIndex separately but we can verify.
                        // Actually, I should remove the duplicate calculation below if I moved it here?
                        // No I will just use `zIndex` variable which was calculated above.
                        zIndex: Math.round(parseFloat(isi.f || '1')),
                        layouts: Object.keys(layouts).length > 0 ? layouts : undefined
                    };


                    // Resolve paths
                    if (imageSet.imageOff) {
                        const p = resolveImagePath(imageSet.imageOff.toString());
                        if (p) element.imageOff = p;
                    }
                    if (imageSet.imageOn) {
                        const p = resolveImagePath(imageSet.imageOn.toString());
                        if (p) element.imageOn = p;
                    }

                    // Fallbacks for masks if actual images are missing
                    if (!element.imageOff && imageSet.j) {
                        const p = resolveImagePath(imageSet.j.toString());
                        if (p) element.imageOff = p;
                    }
                    if (!element.imageOn && imageSet.k) {
                        const p = resolveImagePath(imageSet.k.toString());
                        if (p) element.imageOn = p;
                    }
                    if (!element.imageOff && imageSet.d) {
                        const p = resolveImagePath(imageSet.d.toString());
                        if (p) element.imageOff = p;
                    }

                    // Detect Background & Z-Index
                    // Detect Background & Z-Index
                    if (isBG) {
                        element.isBackground = true;
                    }

                    // Switch detection
                    const isiID = isi.a.toString();
                    const switchObj = switches.find((sw: any) =>
                        sw.a?.toString() === isiID ||
                        sw.k?.toString() === imageSetID ||
                        sw.c?.toString() === imageSetID ||
                        sw.a?.toString() === isi.m?.toString()
                    );

                    if (switchObj) {
                        element.type = 'Switch';
                        const sid = switchObj.a.toString();
                        element.linkId = switchIdToStopId.get(sid) || sid;
                    }

                    // Decide on a default zIndex. 
                    let newZIndex = parseInt(isi.f || (isBG ? '1' : '7'));
                    element.zIndex = newZIndex;

                    if (isBG && !screen.backgroundImage) {
                        if (element.imageOff || element.imageOn) {
                            screen.backgroundImage = element.imageOff || element.imageOn;
                        } else if (imageSet.d) {
                            const p = resolveImagePath(imageSet.d.toString());
                            if (p) screen.backgroundImage = p;
                        }
                    }

                    // Always add to elements, don't pull out the background
                    screen.elements.push(element);
                }
            }
        });

        // Stable sort elements by zIndex to ensure correct rendering order.
        // We also prioritize background-like elements to the bottom of their layer.
        screen.elements.sort((a, b) => {
            const az = a.zIndex || 0;
            const bz = b.zIndex || 0;
            if (az !== bz) return az - bz;

            // Tie-breaker: Move backgrounds to the bottom of the layer
            const isBG = (el: any) => el.name.toLowerCase().includes('background') || el.name.toLowerCase().includes('pozadi') || (el.x === 0 && el.y === 0 && (el.width >= screen.width * 0.95 || el.width === 0));

            const aIsBG = isBG(a);
            const bIsBG = isBG(b);

            if (aIsBG && !bIsBG) return -1;
            if (!aIsBG && bIsBG) return 1;

            return 0; // Maintain original XML order for same layer/type
        });

        // Assign enabled layouts to the screen
        if (enableLayout1 && layout1W > 0 && layout1H > 0) {
            screen.alternateLayouts![1] = { width: layout1W, height: layout1H };
        }
        if (enableLayout2 && layout2W > 0 && layout2H > 0) {
            screen.alternateLayouts![2] = { width: layout2W, height: layout2H };
        }

        organData.screens.push(screen);
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

        //wavPath = resolvePath(attackSampleID) || '';
        //relPathStr = resolvePath(releaseSampleID);

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

        // Back-populate stopIds to ranks
        rankIds.forEach(rid => {
            if (organData.ranks[rid]) {
                organData.ranks[rid].stopIds.push(id);
            }
        });
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
            // Accept both wav and wv (lossless compression) formats, and common image formats
            if (lowerFile.endsWith('.wav') || lowerFile.endsWith('.wv') ||
                lowerFile.endsWith('.bmp') || lowerFile.endsWith('.png') || lowerFile.endsWith('.jpg')) {
                callback(fullPath);
            }
        }
    }
}
