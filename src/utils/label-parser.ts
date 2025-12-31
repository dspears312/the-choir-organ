/**
 * Parses an organ stop name to extract the pitch (footage) and clean the name.
 * Handles fractional footages (e.g., 2 2/3') and filters out manual prefixes.
 */
export function parseStopLabel(fullName: string): { name: string; pitch: string } {
    if (!fullName) return { name: '', pitch: '' };

    // Regex to match footage like 8', 16', 2 2/3', 1 1/7' etc.
    // Matches digits followed by optional space and fraction, then a single quote.
    const pitchRegex = /(\d+(?:\s+\d+\/\d+)?)\'/;
    const match = fullName.match(pitchRegex);

    let pitch = '';
    let cleanName = fullName;

    if (match) {
        pitch = match[1] + "'";
        // Remove the pitch from the name, and any surrounding whitespace
        cleanName = fullName.replace(match[0], '').trim();
    }

    // Filter out manual-related prefixes: SW, GT, HW, P, PED, PD, PT
    // Must be at the beginning of the string and followed by a space or word boundary
    const manualPrefixRegex = /^(?:SW|GT|HW|P|PED|PD|PT|GO)\b\s*/i;
    cleanName = cleanName.replace(manualPrefixRegex, '');

    // Clean up any double spaces or trailing/leading punctuation that might be left
    cleanName = cleanName.replace(/\s\s+/g, ' ').trim();

    return {
        name: cleanName,
        pitch: pitch
    };
}
