
import { parseHauptwerk } from '../src-electron/utils/hauptwerk-parser';
import path from 'path';

const organFile = path.resolve(process.cwd(), 'Rotterdam - Laurenskerk, Hoofdorgel Surround.Organ_Hauptwerk_xml');

console.log(`Parsing: ${organFile}`);

try {
    const data = parseHauptwerk(organFile);
    console.log(`\nFound ${data.screens.length} screens:`);
    data.screens.forEach(s => {
        console.log(`- [${s.id}] "${s.name}": ${s.width}x${s.height} (BG: ${s.backgroundImage ? 'Yes' : 'No'})`);
    });
} catch (e) {
    console.error(e);
}
