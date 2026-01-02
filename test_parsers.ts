import { parseHauptwerk } from './src-electron/utils/hauptwerk-parser';
import path from 'path';

async function test() {
    console.log('Refined Testing Velesovo Wet (Hauptwerk) Recursive Linkage...');
    const hwPath = '/Users/danielspears/Developer/sml-tco-prime-parsec/Velesovo Wet.Organ_Hauptwerk_xml';

    try {
        const hwData = parseHauptwerk(hwPath);

        // Find all interactive Spitzfoett 4 elements
        const allSpitz = hwData.screens.flatMap(s => s.elements.filter(el => el.name.includes('Spitzfoett 4') && el.type === 'Switch'));

        console.log(`Found ${allSpitz.length} interactive Spitzfoett elements.`);
        allSpitz.forEach(el => {
            console.log(` - Element: ${el.name}, linkId: ${el.linkId} (type: ${typeof el.linkId})`);
        });

        const linkIds = new Set(allSpitz.map(el => el.linkId));
        if (linkIds.size === 1 && allSpitz.every(el => el.linkId === '2')) {
            console.log('\nSUCCESS: All interactive Spitzfoett elements unified to Stop ID 2');
        } else {
            console.log(`\nFAILURE: Inconsistent linkIds: ${Array.from(linkIds).join(', ')}`);
        }

        // Also check if Stop ID 2 exists in the stops map
        if (hwData.stops['2']) {
            console.log('SUCCESS: Stop ID 2 exists in organData.stops');
        } else {
            console.log('FAILURE: Stop ID 2 missing from organData.stops');
        }

    } catch (e) {
        console.error('Hauptwerk Parse Failed:', e);
    }
}

test();
