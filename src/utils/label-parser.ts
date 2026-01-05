/**
 * Parses an organ stop name to extract the pitch (footage) and clean the name.
 * Handles fractional footages (e.g., 2 2/3') and filters out manual prefixes.
 */
export function parseStopLabel(fullName: string): { name: string; pitch: string; classification: StopClassification } {
    if (!fullName) return { name: '', pitch: '', classification: null };

    // 1. Identify and Strip Manual Prefix
    // Supports: SW, GT, HW, P, PED, PD, PT, GO, POS, I-VI, 1-9
    // Optional separator: . :
    // Must be word boundary.
    // Negative lookahead (?!\s*\d+\/) prevents matching "2" in "2 2/3"
    // Negative lookahead (?!') prevents matching "8" in "8' Principal".
    const manualRegex = /^(?:SW|SL|GT|HW|P|PED|PD|PT|GO|POS|IV|VI|V|III|II|I|([1-9]))(?:(?:\.|:)|\b)\s*(?!'|\d+\/)/i;

    let cleanName = fullName;
    let possiblePitchFromManual = '';

    const manualMatch = cleanName.match(manualRegex);
    if (manualMatch) {
        // If we captured a digit group (group 1), store it just in case.
        if (manualMatch[1]) {
            possiblePitchFromManual = manualMatch[1];
        }

        cleanName = cleanName.replace(manualMatch[0], '').trim();
    }

    // 2. Parse Pitch
    // Regex to match footage like 8', 16', 2 2/3', 1 1/7' etc. OR "ZW"
    // Matches digits with optional fraction, followed by single quote OR backtick OR word boundary.
    const pitchRegex = /(?:(\d+(?:\s+\d+\/\d+)?)|(ZW))(?:'|`|\b)/i;
    const pitchMatch = cleanName.match(pitchRegex);

    let pitch = '';

    if (pitchMatch) {
        if (pitchMatch[1]) {
            // Numeric pitch
            pitch = pitchMatch[1] + "'";
        } else if (pitchMatch[2]) {
            // "ZW" or special pitch
            pitch = pitchMatch[2].toUpperCase();
        }

        cleanName = cleanName.replace(pitchMatch[0], '').trim();
    } else if (possiblePitchFromManual) {
        // Fallback: The stripped manual was actually the pitch (e.g. "8 Principal")
        pitch = possiblePitchFromManual + "'";
        // We stripped it from cleanName already, so cleanName is "Principal".
    }

    // Clean up any double spaces or trailing/leading punctuation that might be left
    cleanName = cleanName.replace(/\s\s+/g, ' ').trim();

    const classification = classifyStop(cleanName, pitch);

    return {
        name: cleanName,
        pitch: pitch,
        classification
    };
}

export type StopClassification = 'Principal' | 'Flute' | 'String' | 'Reed' | 'Mixture' | 'Coupler' | 'Tremulant' | null;

function classifyStop(name: string, pitch: string): StopClassification {
    const n = name.toLowerCase();

    // 0. Explicit Flute/String Exceptions (prioritized to prevent false Reed matches)
    // "Gemshorn" and "Nachthorn" contain "horn" so must be caught before Reeds or "horn" must be stricter.
    if (matchesAny(n, [
        'gemshorn', 'nachthorn', 'nachthoorn', 'spitzflote', 'spitsfluit', 'blockflote', 'blokfluit',
        'flute', 'flote', 'fluit', 'gedackt', 'gedeckt', 'gedekt', 'holpijp', 'baarpijp',
        'bourdon', 'subbass', 'rohr', 'roer', 'hohl', 'spill', 'wald', 'woud', 'tibia', 'piccolo', 'nazard', 'koppel',
        'block', 'stopped', 'bordun', 'fern', 'jubal', 'portunal', 'pommer', 'soubasse', 'bordone', 'bordun',
        'quintadeen', 'dwarsfluit'
    ])) return 'Flute';

    // 1. Reeds
    if (matchesAny(n, [
        'trumpet', 'trompette', 'tromba', 'trompeta', 'posaune', 'tuba', 'oboe', 'hautbois', 'fagott', 'basson',
        'clarinet', 'clarin', 'krummhorn', 'kromhoor', 'cromorne', 'vox humana', 'voix humaine', 'bombarde',
        'clairon', 'dulcian', 'dulciaan', 'regal', 'regaal', 'rankett', 'schalmei', 'ophicleide', 'basset',
        'chalumeau', 'corno', 'trombon', 'waldhorn', 'french horn', 'english horn', 'bazuin', 'zink', 'orlos', 'trompete', 'trompet', 'fagot'
    ]) || /\bhorn\b/i.test(n)) return 'Reed';

    // 2. Mixtures & Mutations
    if (matchesAny(n, [
        'mixture', 'fourniture', 'plein', 'cymbal', 'cimbel', 'scharff', 'scherp', 'cornet', 'sesquialtera',
        'sesquialter', 'larigot', 'nasard', 'tierce', 'terts', 'tertiaan', 'quinte', 'septieme', 'rausch',
        'ruispijp', 'acuta', 'progressio', 'nineteenth', 'twenty-second', 'zimb', 'mixtur', 'sifflet',
        'carillon', 'ripien', 'mixtuur', 'cymbel', 'ruijspijp'
    ]) || pitch.includes('/')) return 'Mixture';

    // 3. Strings
    if (matchesAny(n, [
        'gamba', 'viol', 'cello', 'salicional', 'aeoline', 'celeste', 'viole', 'fugara', 'dulciana',
        'geigen', 'gamb', 'salicet', 'violone', 'contre basse', 'contrabass'
    ])) return 'String';

    // 4. Principals
    if (matchesAny(n, [
        'principal', 'diapason', 'octave', 'octaaf', 'ottava', 'prestant', 'montre', 'superoctave', 'fifteenth', 'double',
        'praestant', 'prinzipal', 'tenor', 'open', 'double', 'twelfth', 'quintadecim'
    ])) return 'Principal';

    return null;
}

function matchesAny(text: string, keywords: string[]): boolean {
    return keywords.some(k => text.includes(k));
}
