import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_FILE = 'user-settings.json';
const ORGAN_STATES_DIR = 'organ-states';
const ORGAN_CACHE_DIR = 'organ-cache';

function getOrganCachePath(odfPath: string): string {
    const cacheDir = path.join(app.getPath('userData'), ORGAN_CACHE_DIR);
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    try {
        const stats = fs.statSync(odfPath);
        const mtime = stats.mtime.getTime();
        const size = stats.size;
        const hash = crypto.createHash('md5').update(`${odfPath}:${mtime}:${size}`).digest('hex');
        return path.join(cacheDir, `${hash}.json`);
    } catch (e) {
        // Fallback to path-only hash if file doesn't exist (unlikely here but safe)
        const hash = crypto.createHash('md5').update(odfPath).digest('hex');
        return path.join(cacheDir, `${hash}.json`);
    }
}

export function saveOrganCache(odfPath: string, data: any) {
    try {
        const p = getOrganCachePath(odfPath);
        fs.writeFileSync(p, JSON.stringify(data));
    } catch (e) {
        console.error(`Failed to save organ cache for ${odfPath}`, e);
    }
}

export function loadOrganCache(odfPath: string): any | null {
    try {
        const p = getOrganCachePath(odfPath);
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error(`Failed to load organ cache for ${odfPath}`, e);
    }
    return null;
}

interface UserSettings {
    recentOdfs: string[];
    lastExportDir: string;
    workerCount: number;
    isWebServerEnabled?: boolean;
    remoteServerPort?: number;
}

const DEFAULT_SETTINGS: UserSettings = {
    recentOdfs: [],
    lastExportDir: '',
    workerCount: 1,
    isWebServerEnabled: false,
    remoteServerPort: 56789
};

function getSettingsPath(): string {
    return path.join(app.getPath('userData'), DATA_FILE);
}

function getOrganStatePath(odfPath: string): string {
    const statesDir = path.join(app.getPath('userData'), ORGAN_STATES_DIR);
    if (!fs.existsSync(statesDir)) {
        fs.mkdirSync(statesDir, { recursive: true });
    }
    // Create a stable hash of the path to use as filename
    const hash = crypto.createHash('md5').update(odfPath).digest('hex');
    return path.join(statesDir, `${hash}.json`);
}

export function loadSettings(): UserSettings {
    try {
        const p = getSettingsPath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Partial<UserSettings>) {
    try {
        const current = loadSettings();
        const updated = { ...current, ...settings };
        fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

export function saveOrganState(odfPath: string, state: any) {
    try {
        const p = getOrganStatePath(odfPath);
        console.log(`[Persistence] Saving organ state to ${p}. Keys: ${Object.keys(state)}`);
        fs.writeFileSync(p, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error(`Failed to save organ state for ${odfPath}`, e);
    }
}

export function loadOrganState(odfPath: string): any | null {
    try {
        const p = getOrganStatePath(odfPath);
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const data = JSON.parse(raw);
            console.log(`[Persistence] Loaded organ state from ${p}. Keys: ${Object.keys(data)}`);
            return data;
        }
    } catch (e) {
        console.error(`Failed to load organ state for ${odfPath}`, e);
    }
    return null;
}

export function addToRecent(filePath: string) {
    if (!filePath || typeof filePath !== 'string') return;
    const settings = loadSettings();
    let recents = settings.recentOdfs || [];
    recents = recents.filter(p => typeof p === 'string');
    recents = recents.filter(p => p !== filePath);
    recents.unshift(filePath);
    recents = recents.slice(0, 10);
    saveSettings({ recentOdfs: recents });
}

export function getRecents(): string[] {
    const settings = loadSettings();
    return (settings.recentOdfs || []).filter(p => typeof p === 'string');
}

export function removeFromRecent(filePath: string) {
    if (!filePath || typeof filePath !== 'string') return;
    const settings = loadSettings();
    let recents = settings.recentOdfs || [];
    recents = recents.filter(p => typeof p === 'string');
    recents = recents.filter(p => p !== filePath);
    saveSettings({ recentOdfs: recents });
}

