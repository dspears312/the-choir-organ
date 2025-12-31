import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url'
import { setImmediate } from 'timers';
import { parseODF } from './utils/odf-parser';
import { renderNote } from './utils/renderer';
import { readWav } from './utils/wav-reader';
import { addToRecent, getRecents, saveOrganState, loadOrganState } from './utils/persistence';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();

const currentDir = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | undefined;
let isCancellationRequested = false;

// Configure autoUpdater
autoUpdater.autoDownload = false; // We will let the user decide
autoUpdater.autoInstallOnAppQuit = true;

async function createWindow() {
  /**
   * Initial window options
   */
  mainWindow = new BrowserWindow({
    icon: path.resolve(currentDir, 'icons/icon.png'), // tray icon
    width: 1200,
    height: 800,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      // More info: https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
      preload: path.resolve(
        currentDir,
        path.join(process.env.QUASAR_ELECTRON_PRELOAD_FOLDER, 'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION)
      ),
    },
  });

  if (process.env.DEV) {
    await mainWindow.loadURL(process.env.APP_URL);
  } else {
    await mainWindow.loadFile('index.html');
  }

  if (process.env.DEBUGGING) {
    // if on DEV or Production with debug enabled
    // mainWindow.webContents.openDevTools();
  } else {
    // we're on production; no access to devtools pls
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

// IPC Handlers
ipcMain.handle('select-odf-file', async (event, specificPath?: string) => {
  let filePath = specificPath;

  if (!filePath) {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'GrandOrgue ODF', extensions: ['organ'] }]
    });
    filePath = result.filePaths[0];
  }

  if (!filePath) return null;

  try {
    addToRecent(filePath);
    return parseODF(filePath);
  } catch (e: any) {
    console.error(e);
    return { error: e.message };
  }
});

ipcMain.handle('cancel-rendering', () => {
  isCancellationRequested = true;
});

ipcMain.handle('render-bank', async (event, { bankNumber, combination, organData, outputDir: initialOutputDir }) => {
  let outputDir = initialOutputDir;
  if (!outputDir) {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Output Directory for Tsunami SD Card'
    });
    if (result.canceled) return { status: 'cancelled' };
    outputDir = result.filePaths[0];
  }

  if (!outputDir) return { status: 'error', message: 'No output directory selected' };

  isCancellationRequested = false;
  const notes = Array.from({ length: 61 }, (_, i) => 36 + i);

  for (let i = 0; i < notes.length; i++) {
    if (isCancellationRequested) {
      return { status: 'cancelled', outputDir };
    }
    const note = notes[i] as number;
    // Four digit file number = MIDI Note + (Bank Number * 128)
    const trackNumber = note + (bankNumber * 128);

    // Find pipes for this note across active stops
    const activePipes: any[] = [];
    combination.forEach((stopId: string) => {
      const stop = organData.stops[stopId];
      if (stop) {
        const manual = organData.manuals.find((m: any) => String(m.id) === String(stop.manualId));
        const isPedal = manual?.name.toLowerCase().includes('pedal') || false;

        const noteOffset = stop.noteOffset || 0;
        const adjustedNote = note + noteOffset;

        stop.rankIds.forEach((rankId: string) => {
          const rank = organData.ranks[rankId];
          if (rank) {
            const pipe = rank.pipes.find((p: any) => p.midiNote === adjustedNote) || rank.pipes[adjustedNote - 36];
            if (pipe) {
              // Hierarchical Gain Summation (excluding Organ global gain, passed separately)
              const combinedGain = (manual?.gain || 0) + (stop.gain || 0) + (rank.gain || 0) + (pipe.gain || 0);

              activePipes.push({
                path: pipe.wavPath,
                volume: stop.volume ?? 100,
                isPedal,
                gain: combinedGain,
                pitchOffsetCents: stop.pitchShift || 0,
                harmonicNumber: (pipe.harmonicNumber || 1) * (stop.harmonicMultiplier || 1),
                manualId: stop.manualId,
                renderingNote: adjustedNote
              });
            }
          }
        });
      }
    });

    // Find active tremulants for this note's manuals
    const activeTremulants: any[] = [];
    combination.forEach((stopId: string) => {
      if (stopId.startsWith('TREM_')) {
        const tremId = stopId.replace('TREM_', '');
        const trem = organData.tremulants[tremId];
        if (trem) {
          activeTremulants.push(trem);
        }
      }
    });

    if (activePipes.length > 0) {
      await renderNote(note, activePipes, outputDir, trackNumber, organData.globalGain || 0, activeTremulants);
    }

    // Report progress
    const progress = Math.round(((i + 1) / notes.length) * 100);
    event.sender.send('render-progress', progress);

    // Yield to event loop to avoid blocking main thread completely
    await new Promise(resolve => setImmediate(resolve));
  }

  return { status: 'success', outputDir };
});

ipcMain.handle('read-file-arraybuffer', async (event, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch (e) {
    console.error(`Failed to read file as array buffer: ${filePath}`, e);
    throw e;
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Tsunami Sample Folder'
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('get-wav-info', async (event, filePath: string) => {
  try {
    const info = readWav(filePath);
    const { data: _data, ...metadata } = info;
    return metadata;
  } catch (e) {
    console.error(`Failed to get wav info: ${filePath}`, e);
    return null;
  }
});

ipcMain.handle('list-dir', async (event, folderPath: string) => {
  try {
    const files = fs.readdirSync(folderPath);
    return files.filter(f => f.toLowerCase().endsWith('.wav'));
  } catch (e) {
    console.error('Failed to list dir', e);
    return [];
  }
});

ipcMain.handle('get-recent-files', async () => {
  return getRecents();
});

ipcMain.handle('save-organ-state', async (event, { odfPath, state }) => {
  return saveOrganState(odfPath, state);
});

ipcMain.handle('load-organ-state', async (event, odfPath) => {
  return loadOrganState(odfPath);
});

ipcMain.handle('get-app-version', () => {
  return process.env.APP_VERSION || app.getVersion();
});

// Update Handlers
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return result;
  } catch (error: any) {
    console.error('Check for updates error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error: any) {
    console.error('Download update error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

// AutoUpdater Events
autoUpdater.on('update-available', (info: any) => {
  mainWindow?.webContents.send('update-available', info);
});

autoUpdater.on('update-not-available', (info: any) => {
  mainWindow?.webContents.send('update-not-available', info);
});

autoUpdater.on('download-progress', (progressObj: any) => {
  mainWindow?.webContents.send('update-download-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info: any) => {
  mainWindow?.webContents.send('update-downloaded', info);
});

autoUpdater.on('error', (err: any) => {
  mainWindow?.webContents.send('update-error', err.message);
});

void app.whenReady().then(() => {
  createWindow();
  // Check for updates after a short delay on startup
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err: any) => {
      console.error('Initial check for updates failed:', err);
    });
  }, 3000);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === undefined) {
    void createWindow();
  }
});
