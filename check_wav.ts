import { readWav } from './src-electron/utils/wav-reader';
import path from 'path';

const file = process.argv[2];
if (!file) {
    console.error('No file provided');
    process.exit(1);
}

const info = readWav(path.resolve(file));
console.log(JSON.stringify({
    unityNote: info.unityNote,
    pitchFraction: info.pitchFraction,
    sampleRate: info.sampleRate
}, null, 2));
