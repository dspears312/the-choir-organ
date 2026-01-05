import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron';
import { WorkerFactory } from './utils/worker-factory';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url'
import { setImmediate } from 'timers';
import { exec } from 'child_process';
import { OrganData, parseODF } from './utils/odf-parser';
import { parseHauptwerk } from './utils/hauptwerk-parser';
import { renderNote, renderPerformance } from './utils/renderer';
import { readWav } from './utils/wav-reader';
import { addToRecent, getRecents, loadOrganState, loadSettings, removeFromRecent, saveOrganState, saveSettings, loadOrganCache, saveOrganCache } from './utils/persistence';
import { handleRarExtraction } from './utils/archive-handler';
import { scanOrganDependencies } from './utils/organ-manager';
import { createPartialWav } from './utils/partial-wav';
import { checkAndPromptForSelfRepair, performSelfRepair } from './utils/self-signer';
import { startWebServer, stopWebServer, getWebServerStatus, updateRemoteState, setMainWindow } from './utils/web-server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { autoUpdater } = require('electron-updater');
// import v8 from 'v8';
// import vm from 'vm';

// // Programmatically Enable GC in Main Process (Node.js)
// v8.setFlagsFromString('--expose_gc');
// if (!global.gc) {
//   try {
//     global.gc = vm.runInNewContext('gc');
//     console.log('[Main] V8 GC exposed programmatically.');
//   } catch (e) {
//     console.error('[Main] Failed to expose GC:', e);
//   }
// }

// // Pass flags to Renderer Process (Chrome)
// app.commandLine.appendSwitch('js-flags', '--expose_gc --max_old_space_size=12288');


// needed in case process is undefined under Linux

const platform = process.platform || os.platform();

const currentDir = fileURLToPath(new URL('.', import.meta.url));

// Register protocols as privileged for media streaming
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tsunami',
    privileges: {
      stream: true,
      bypassCSP: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'organ-sample',
    privileges: {
      stream: true,
      bypassCSP: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'organ-img',
    privileges: {
      stream: true,
      bypassCSP: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);







let mainWindow: BrowserWindow | undefined;
let workerWindows: BrowserWindow[] = [];
let isCancellationRequested = false;
let memoryInterval: NodeJS.Timeout | null = null;

// Batched Sample Progress Tracking
let batchedSampleCount = 0;
let lastBatchTime = 0;
const BATCH_INTERVAL_MS = 100;

function sendBatchedProgress() {
  if (batchedSampleCount > 0 && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sample-loaded-batch', batchedSampleCount);
    batchedSampleCount = 0;
    lastBatchTime = Date.now();
  }
}

ipcMain.on('sample-loaded', (event) => {
  batchedSampleCount++;
  const now = Date.now();
  if (now - lastBatchTime > BATCH_INTERVAL_MS) {
    sendBatchedProgress();
  }
});

ipcMain.handle('reset-progress-buffer', () => {
  batchedSampleCount = 0;
  lastBatchTime = 0;
  return true;
});


function startMemoryMonitoring(window: BrowserWindow) {
  if (memoryInterval) clearInterval(memoryInterval);

  memoryInterval = setInterval(async () => {
    if (!window || window.isDestroyed()) {
      if (memoryInterval) clearInterval(memoryInterval);
      return;
    }

    try {
      const metrics = app.getAppMetrics();
      // Calculate total working set size (RAM usage) across all processes
      // workingSetSize is in Kilobytes, so multiply by 1024 to get Bytes
      const totalBytes = metrics.reduce((acc, metric) => acc + (metric.memory.workingSetSize * 1024), 0);

      window.webContents.send('memory-update', totalBytes);
    } catch (e) {
      console.error('Failed to get memory usage', e);
    }
  }, 2000); // Update every 2 seconds
}



async function listDrives(): Promise<any[]> {
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      exec('diskutil list -plist external', async (error, stdout) => {
        if (error) return resolve([]);
        // Parse the plist for all mount points
        const mountPoints = stdout.match(/<key>MountPoint<\/key>\s*<string>(.*?)<\/string>/g) || [];
        const drives = await Promise.all(mountPoints.map(async (m) => {
          const pathStr = m.match(/<string>(.*?)<\/string>/)?.[1];
          if (!pathStr) return null;
          return await getDiskInfo(pathStr);
        }));
        resolve(drives.filter((d: any) => d && d.isRemovable));
      });
    });
  } else if (process.platform === 'win32') {
    return new Promise((resolve) => {
      exec('powershell "Get-Volume | Where-Object {$_.DriveType -eq \'Removable\'} | Select-Object -Property DriveLetter,DriveType,FileSystemLabel,FileSystem | ConvertTo-Json"', (error, stdout) => {
        if (error || !stdout) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const volumes = Array.isArray(data) ? data : [data];
          resolve(volumes.map(v => ({
            isRemovable: true,
            deviceIdentifier: v.DriveLetter,
            volumeName: v.FileSystemLabel,
            mountPoint: v.DriveLetter + ':\\',
            isRoot: true,
            platform: 'win32'
          })));
        } catch (e) { resolve([]); }
      });
    });
  } else {
    // Linux
    return new Promise((resolve) => {
      exec('lsblk -J -o NAME,MOUNTPOINT,RM,LABEL', (error, stdout) => {
        if (error) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const drives: any[] = [];
          const traverse = (devices: any[]) => {
            for (const d of devices) {
              if (d.mountpoint && (d.rm === true || d.rm === "1" || d.rm === 1)) {
                drives.push({
                  isRemovable: true,
                  deviceIdentifier: d.name.startsWith('/') ? d.name : `/dev/${d.name}`,
                  volumeName: d.label,
                  mountPoint: d.mountpoint,
                  isRoot: true,
                  platform: 'linux'
                });
              }
              if (d.children) traverse(d.children);
            }
          };
          traverse(data.blockdevices || []);
          resolve(drives);
        } catch (e) { resolve([]); }
      });
    });
  }
}

async function getDiskInfo(folderPath: string) {
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      exec(`diskutil info -plist "${folderPath}"`, (error, stdout) => {
        if (error) return resolve(null);
        const isRemovable = /<key>RemovableMedia<\/key>\s*<true\/>/.test(stdout) || /<key>BusProtocol<\/key>\s*<string>USB<\/string>/.test(stdout);
        const deviceIdentifier = stdout.match(/<key>DeviceIdentifier<\/key>\s*<string>(.*?)<\/string>/)?.[1];
        const volumeName = stdout.match(/<key>VolumeName<\/key>\s*<string>(.*?)<\/string>/)?.[1];
        const mountPoint = stdout.match(/<key>MountPoint<\/key>\s*<string>(.*?)<\/string>/)?.[1];
        const isRoot = mountPoint && (path.resolve(folderPath) === path.resolve(mountPoint));

        resolve({
          isRemovable,
          deviceIdentifier,
          volumeName,
          isRoot,
          mountPoint,
          platform: 'darwin'
        });
      });
    });
  } else if (process.platform === 'win32') {
    const driveLetter = folderPath.match(/^([a-zA-Z]):/)?.[1];
    if (!driveLetter) return null;
    return new Promise((resolve) => {
      exec(`powershell "Get-Volume -DriveLetter ${driveLetter} | Select-Object -Property DriveLetter,DriveType,FileSystemLabel,FileSystem | ConvertTo-Json"`, (error, stdout) => {
        if (error) return resolve(null);
        try {
          const info = JSON.parse(stdout);
          resolve({
            isRemovable: info.DriveType === 2 || info.DriveType === 'Removable',
            deviceIdentifier: driveLetter,
            volumeName: info.FileSystemLabel,
            mountPoint: driveLetter + ':\\',
            isRoot: folderPath.length <= 3,
            platform: 'win32'
          });
        } catch (e) { resolve(null); }
      });
    });
  } else {
    // Linux
    return new Promise((resolve) => {
      exec(`lsblk -J -o NAME,MOUNTPOINT,RM,LABEL`, (error, stdout) => {
        if (error) return resolve(null);
        try {
          const data = JSON.parse(stdout);
          const findMount = (devices: any[]): any => {
            for (const d of devices) {
              if (d.mountpoint && path.resolve(d.mountpoint) === path.resolve(folderPath)) return { device: d, target: d };
              if (d.children) {
                const found = findMount(d.children);
                if (found) return { device: d, target: found.target };
              }
            }
            return null;
          };
          const found = findMount(data.blockdevices || []);
          if (found) {
            resolve({
              isRemovable: found.device.rm === true || found.device.rm === "1" || found.device.rm === 1,
              deviceIdentifier: found.target.name.startsWith('/') ? found.target.name : `/dev/${found.target.name}`,
              volumeName: found.target.label,
              mountPoint: found.target.mountpoint,
              isRoot: true,
              platform: 'linux'
            });
          } else resolve(null);
        } catch (e) { resolve(null); }
      });
    });
  }
}

// Configure autoUpdater
autoUpdater.autoDownload = false; // We will let the user decide
autoUpdater.autoInstallOnAppQuit = true;

async function createWindow() {
  // Check for self-repair need on startup
  await checkAndPromptForSelfRepair(undefined);

  /**
   * Initial window options
   */

  mainWindow = new BrowserWindow({
    icon: path.resolve(currentDir, 'icons/icon.png'), // tray icon
    width: 1200,
    height: 800,
    useContentSize: true,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    fullscreen: !process.env.DEV,
    webPreferences: {
      contextIsolation: true,
      // More info: https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
      preload: path.resolve(
        currentDir,
        path.join(process.env.QUASAR_ELECTRON_PRELOAD_FOLDER, 'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION)
      ),
    },
  });

  // Provide web-server with the correct main window reference
  setMainWindow(mainWindow);

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
    // mainWindow.webContents.on('devtools-opened', () => {
    //   mainWindow?.webContents.closeDevTools();
    // });
  }

  startMemoryMonitoring(mainWindow);


  mainWindow.on('closed', () => {
    mainWindow = undefined;
    if (memoryInterval) {
      clearInterval(memoryInterval);
      memoryInterval = null;
    }
  });

  // Window State Events
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-state-changed', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-state-changed', 'normal'));
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('window-state-changed', 'fullscreen'));
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('window-state-changed', 'normal'));

  // DevTools Events
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow?.webContents.send('devtools-change', true);
  });
  mainWindow.webContents.on('devtools-closed', () => {
    mainWindow?.webContents.send('devtools-change', false);
  });

  // Window Controls
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-toggle-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });
}

ipcMain.handle('is-devtools-opened', () => {
  return mainWindow?.webContents.isDevToolsOpened();
});

// IPC Handlers
ipcMain.handle('select-odf-file', async (event, specificPath?: string) => {
  let filePath = specificPath;
  let allSelectedPaths: string[] = [];

  if (!filePath) {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Organ Files', extensions: ['organ', 'xml', 'Organ_Hauptwerk_xml', 'rar'] },
        { name: 'GrandOrgue ODF', extensions: ['organ'] },
        { name: 'Hauptwerk XML', extensions: ['xml', 'Organ_Hauptwerk_xml'] },
        { name: 'RAR Archives', extensions: ['rar'] }
      ]
    });
    if (result.filePaths.length === 0) return null;
    filePath = result.filePaths[0];
    allSelectedPaths = result.filePaths;
  } else {
    allSelectedPaths = [filePath];
  }

  if (!filePath) return null;

  try {
    // If it's a RAR archive (or multiple), handle extraction
    if (allSelectedPaths.some(p => p.toLowerCase().endsWith('.rar'))) {
      const extractedOdf = await handleRarExtraction(allSelectedPaths, mainWindow!);
      if (extractedOdf) {
        filePath = extractedOdf;
      } else {
        return { error: 'No organ definition files found in the archive(s).' };
      }
    }

    addToRecent(filePath);

    // 1. Check Cache
    const cachedData = loadOrganCache(filePath);
    if (cachedData) {
      console.log(`[Main] Using cached organ definition for: ${filePath}`);
      return cachedData;
    }

    // 2. Offload parsing to worker thread
    const parsedData = await WorkerFactory.spawn('parser-worker', {
      workerData: { filePath: filePath }
    });

    // 3. Save to Cache if successful
    if (parsedData && !parsedData.error) {
      console.log(`[Main] Saving result to cache for: ${filePath}`);
      saveOrganCache(filePath, parsedData);
    }

    return parsedData;
  } catch (e: any) {
    console.error(e);
    return { error: e.message };
  }
});

ipcMain.handle('cancel-rendering', () => {
  isCancellationRequested = true;
});

ipcMain.handle('render-bank', async (event, { bankNumber, bankName, combination, organData, outputDir: initialOutputDir }) => {
  let outputDir = initialOutputDir;
  if (!outputDir) {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Output Directory for Tsunami SD Card'
    });
    outputDir = result.filePaths[0];
    if (!outputDir) return { status: 'error', message: 'No output directory selected' };
  }

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
                renderingNote: adjustedNote,
                delay: stop.delay || 0
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

  // Update tco.txt with bank name - MOVE TO END
  try {
    const tcoPath = path.join(outputDir, 'tco.txt');
    let tcoContent = '';
    if (fs.existsSync(tcoPath)) {
      tcoContent = fs.readFileSync(tcoPath, 'utf8');
    }

    const lines = tcoContent.split('\n').filter(l => l.trim());
    const bankMap: Record<number, string> = {};
    lines.forEach(line => {
      const match = line.match(/^(\d+):\s*(.*)$/);
      if (match) {
        bankMap[parseInt(match[1] as string, 10)] = match[2] as string;
      }
    });

    bankMap[bankNumber] = bankName || `Bank ${bankNumber + 1}`;

    const sortedContent = Object.keys(bankMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map(idx => `${idx}: ${bankMap[idx]}`)
      .join('\n');

    fs.writeFileSync(tcoPath, sortedContent);
  } catch (e) {
    console.error('Failed to update tco.txt', e);
  }

  return { status: 'success', outputDir };
});

ipcMain.handle('render-performance', async (event, { recording, organData, renderTails, banks }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Performance Recording',
    defaultPath: `${recording.name}.wav`,
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  try {
    await WorkerFactory.spawn('render-worker', {
      workerData: {
        recording,
        organData,
        outputPath: result.filePath,
        renderTails,
        banks
      },
      onProgress: (progress) => {
        mainWindow?.webContents.send('render-progress', { status: 'Rendering Performance...', progress });
      }
    });

    mainWindow?.webContents.send('render-progress', { status: 'Complete', progress: 100 });
    return { success: true, filePath: result.filePath };
  } catch (e: any) {
    console.error('Performance render failed:', e);
    return { error: e.message };
  }
});

ipcMain.handle('read-text-file', async (event, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`Failed to read text file: ${filePath}`, e);
    return null;
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
    const info = readWav(filePath, { metadataOnly: true });
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

ipcMain.handle('load-user-settings', async () => {
  return loadSettings();
});

ipcMain.handle('save-user-settings', async (event, settings) => {
  saveSettings(settings);
});

ipcMain.handle('load-organ-state', async (event, odfPath) => {
  return loadOrganState(odfPath);
});

ipcMain.handle('save-organ-state', async (event, odfPath, state) => {
  saveOrganState(odfPath, state);
});

ipcMain.handle('save-midi-file', async (event, { buffer, filename }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save MIDI File',
    defaultPath: filename,
    filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    fs.writeFileSync(result.filePath, Buffer.from(buffer));
    return { success: true };
  } catch (e: any) {
    console.error('Failed to save MIDI file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('open-midi-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open MIDI File',
    filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0 || !result.filePaths[0]) return { canceled: true };

  try {
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    return { buffer: buffer.buffer, filename: path.basename(filePath) };
  } catch (e: any) {
    console.error('Failed to load MIDI file:', e);
    return { error: e.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return process.env.APP_VERSION || app.getVersion();
});

ipcMain.handle('parse-odf', async (event, odfPath: string) => {
  try {
    if (!fs.existsSync(odfPath)) throw new Error(`File not found: ${odfPath}`);

    // 1. Check Cache first
    const cachedData = loadOrganCache(odfPath);
    if (cachedData) {
      console.log(`[Main] Using cached organ definition for: ${odfPath} (ranks request)`);
      return cachedData;
    }

    // 2. Offload parsing to worker thread
    const parsedData = await WorkerFactory.spawn('parser-worker', {
      workerData: { filePath: odfPath }
    });

    // 3. Save to Cache if successful
    if (parsedData && !parsedData.error) {
      saveOrganCache(odfPath, parsedData);
    }

    return parsedData;
  } catch (e: any) {
    console.error('parse-odf error:', e);
    return { error: e.message };
  }
});

ipcMain.handle('get-disk-info', async (event, folderPath: string) => {
  try {
    return await getDiskInfo(folderPath);
  } catch (e) {
    console.error('get-disk-info error:', e);
    return null;
  }
});

ipcMain.handle('list-removable-drives', async () => {
  try {
    return await listDrives();
  } catch (e) {
    console.error('list-removable-drives error:', e);
    return [];
  }
});
ipcMain.handle('remove-from-recent', async (event, filePath: string) => {
  removeFromRecent(filePath);
  return { success: true };
});

function calculateFolderSize(itemPath: string): number {
  let totalSize = 0;
  try {
    const stats = fs.statSync(itemPath);
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const files = fs.readdirSync(itemPath);
      for (const file of files) {
        totalSize += calculateFolderSize(path.join(itemPath, file));
      }
    }
  } catch (error) {
    // Ignore access errors
  }
  return totalSize;
}

ipcMain.handle('calculate-organ-size', async (event, filePath: string) => {
  try {
    const dependencies = await scanOrganDependencies(filePath);
    let totalSize = 0;
    for (const dep of dependencies) {
      totalSize += calculateFolderSize(dep);
    }
    return { size: totalSize };
  } catch (e: any) {
    console.error('Calculate size error:', e);
    return { error: e.message };
  }
});

ipcMain.handle('delete-organ-files', async (event, filePath: string) => {
  try {
    // Basic Safety Checks
    const userDataPath = app.getPath('userData');

    // We get the dependencies list first
    const dependencies = await scanOrganDependencies(filePath);

    // Validate each dependency
    for (const dep of dependencies) {
      // Must exist
      if (!fs.existsSync(dep)) throw new Error(`Path does not exist: ${dep}`);

      // Root check
      const isRoot = path.dirname(dep) === dep;
      if (isRoot) throw new Error('Cannot delete root directory.');
    }

    // Perform Deletion
    console.log(`Deleting organ dependencies:`, dependencies);
    for (const dep of dependencies) {
      fs.rmSync(dep, { recursive: true, force: true });
    }

    // Also remove from recents
    removeFromRecent(filePath);

    return { success: true };
  } catch (e: any) {
    console.error('Delete organ files error:', e);
    return { error: e.message };
  }
});

ipcMain.handle('delete-organ-cache', async (event, odfPath: string) => {
  try {
    // We need to import deleteOrganCache from persistence
    const { deleteOrganCache } = await import('./utils/persistence');
    return deleteOrganCache(odfPath);
  } catch (e) {
    console.error('delete-organ-cache error:', e);
    return false;
  }
});

ipcMain.handle('delete-organ-save', async (event, odfPath: string) => {
  try {
    const { deleteOrganSave } = await import('./utils/persistence');
    return deleteOrganSave(odfPath);
  } catch (e) {
    console.error('delete-organ-save error:', e);
    return false;
  }
});


ipcMain.handle('format-volume', async (event, { path: folderPath, label }) => {
  const info: any = await getDiskInfo(folderPath);
  if (!info || !info.deviceIdentifier) throw new Error('Could not identify device for formatting');
  if (!info.isRemovable) throw new Error('Safety check failed: Target is not a removable volume.');

  return new Promise((resolve, reject) => {
    let command = '';
    if (process.platform === 'darwin') {
      command = `diskutil eraseVolume FAT32 "${label}" ${info.deviceIdentifier}`;
    } else if (process.platform === 'win32') {
      command = `powershell "Format-Volume -DriveLetter ${info.deviceIdentifier} -FileSystem FAT32 -NewFileSystemLabel '${label}' -Confirm:$false"`;
    } else {
      command = `mkfs.fat -F 32 -n "${label}" ${info.deviceIdentifier}`;
    }

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        console.error('Format error:', stderr);
        return reject(new Error(stderr || 'Format failed. You may need administrative privileges.'));
      }

      // Robust TCO Discovery after formatting
      // We poll for up to 15 seconds for a drive with the new label
      let attempts = 0;
      const poll = async () => {
        const drives = await listDrives();
        const tco = drives.find(d => d.volumeName === label || (process.platform === 'darwin' && d.mountPoint?.endsWith('/' + label)));

        if (tco && tco.mountPoint) {
          resolve({ success: true, newPath: tco.mountPoint });
        } else if (attempts < 30) {
          attempts++;
          setTimeout(poll, 500);
        } else {
          // Fallback if we can't find it definitively, but it was successful
          resolve({ success: true, newPath: null });
        }
      };

      setTimeout(poll, 1500); // Initial wait for OS to unmount/format
    });
  });
});



ipcMain.handle('create-workers', async (event, count: number) => {
  if (count == 0) {
    if (workerWindows.length > 0) {
      console.log(`[Main] Unloading workers...`);
      workerWindows.forEach(w => {
        console.log(w)
        try { w.destroy(); } catch (e) { console.error(e) }
      });
      workerWindows = [];
    }

    return { success: true };
  } else {
    console.log(`[Main] Creating ${count} worker windows...`);

    // Close existing workers
    workerWindows.forEach(w => {
      try { w.destroy(); } catch (e) {/* ignore */ }
    });
  }

  workerWindows = [];
  const loadPromises: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const workerWin = new BrowserWindow({
      show: false, // Keep hidden
      webPreferences: {
        contextIsolation: true,
        autoplayPolicy: 'no-user-gesture-required',
        preload: path.resolve(
          currentDir,
          path.join(process.env.QUASAR_ELECTRON_PRELOAD_FOLDER, 'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION)
        ),
      }
    });

    // workerWin.webContents.openDevTools({ mode: 'detach' }); 
    workerWindows.push(workerWin);

    if (process.env.DEV) {
      loadPromises.push(workerWin.loadURL(`${process.env.APP_URL}/#/worker`));
    } else {
      loadPromises.push(workerWin.loadFile('index.html', { hash: '/worker' }));
    }
  }

  try {
    await Promise.all(loadPromises);
  } catch (e) {
    console.error('[Main] Error loading worker windows:', e);
  }

  return { success: true };
});

ipcMain.on('send-worker-command', (event, { workerIndex, command }) => {
  if (workerWindows[workerIndex]) {
    workerWindows[workerIndex].webContents.send('worker-command', command);
  }
});

ipcMain.on('worker-log', (event, msg) => {
  // Find which worker sent this
  const index = workerWindows.indexOf(BrowserWindow.fromWebContents(event.sender)!);
  if (index === -1) return;
  console.log(`[Worker ${index}] ${msg}`);
});

ipcMain.on('worker-ready', (event) => {
  // Find which worker sent this
  const index = workerWindows.indexOf(BrowserWindow.fromWebContents(event.sender)!);
  if (index === -1) return;
  console.log(`[Main] Worker ${index} is ready.`);
  mainWindow?.webContents.send('worker-ready', index);
});

ipcMain.on('worker-stats', async (event, stats) => {
  // Forward stats to main window
  const wc = event.sender;
  const index = workerWindows.indexOf(BrowserWindow.fromWebContents(wc)!);
  if (index === -1) return;

  // Inject Process Memory Info (from Main process side)
  try {
    const pid = wc.getOSProcessId();
    const metrics = app.getAppMetrics();
    const metric = metrics.find(m => m.pid === pid);

    if (metric) {
      stats.processMemory = {
        rss: metric.memory.workingSetSize * 1024, // Approximation of RSS (Electron returns KB)
        private: (metric.memory.privateBytes || 0) * 1024,
        shared: ((metric.memory as any).sharedBytes || 0) * 1024
      };
    }
  } catch (e) {
    console.warn(`[Main] Failed to get memory for worker ${index}`, e);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('worker-stats', { workerIndex: index, stats });
  }
});

ipcMain.on('sample-loaded', (event, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sample-loaded', data);
  }
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

ipcMain.handle('open-external-url', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error: any) {
    console.error('Open external url error:', error);
    return { error: error.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

// WebServer Handlers
ipcMain.handle('start-web-server', (event, port) => {
  return startWebServer(port);
});

ipcMain.handle('stop-web-server', () => {
  return stopWebServer();
});

ipcMain.handle('get-web-server-status', () => {
  return getWebServerStatus();
});

ipcMain.handle('update-remote-state', (event, { organData, activatedStops, ...extra }) => {
  updateRemoteState(organData, activatedStops, extra);
});

// AutoUpdater Events
autoUpdater.on('update-available', (info: any) => {
  mainWindow?.webContents.send('update-available', info);
});

autoUpdater.on('update-not-available', (info: any) => {
  mainWindow?.webContents.send('update-not-available', info);
});

// Self-Repair Handler
ipcMain.handle('trigger-self-repair', async () => {
  const response = await dialog.showMessageBox({
    type: 'question',
    title: 'Repair Application Signature',
    message: 'This will close the application, remove Apple quarantine attributes, and re-sign the application bundle locally.',
    detail: 'The application will restart automatically when finished.',
    buttons: ['Proceed', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  });

  if (response.response === 0) {
    performSelfRepair();
    return { success: true };
  }
  return { canceled: true };
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

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // Protocol for streaming local tsunami samples
    protocol.handle('tsunami', (request) => {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname);
      console.log('Tsunami Stream Request:', { url: request.url, filePath });

      try {
        if (!fs.existsSync(filePath)) {
          console.warn(`File not found for tsunami stream: ${filePath}`);
          return new Response('File not found', { status: 404 });
        }
        return net.fetch(pathToFileURL(filePath).toString());
      } catch (e) {
        console.error('Tsunami protocol error:', e);
        return new Response('Error', { status: 500 });
      }
    });

    // High-performance protocol for organ samples
    protocol.handle('organ-sample', async (request) => {
      try {
        const url = new URL(request.url);
        const filePath = url.searchParams.get('path');
        const type = url.searchParams.get('type') as 'partial' | 'full';
        const maxDurationStr = url.searchParams.get('maxDuration');
        const maxDuration = maxDurationStr ? parseFloat(maxDurationStr) : undefined;
        const cropToLoop = url.searchParams.get('cropToLoop') === 'true';

        if (!filePath) {
          return new Response('Missing path', { status: 400 });
        }

        // Check if we need special processing (Partial, Quick Load, or Convolution Crop)
        if (type === 'partial' || cropToLoop || maxDuration) {
          const options: PartialWavOptions = {
            cropToLoop,
            maxDuration: maxDuration ?? (type === 'partial' ? 0.5 : undefined)
          };

          const partialBuffer = createPartialWav(decodeURIComponent(filePath), options);
          if (partialBuffer) {
            return new Response(partialBuffer, { headers: { 'Content-Type': 'audio/wav' } });
          }
        }

        // Default: Serve full file efficiently (Stream)
        return net.fetch(pathToFileURL(decodeURIComponent(filePath)).toString());
      } catch (e) {
        console.error('Organ-sample protocol error:', e);
        return new Response('Internal error', { status: 500 });
      }
    });

    // Protocol for loading organ console images (BMP/PNG/JPG)
    protocol.handle('organ-img', (request) => {
      try {
        const url = new URL(request.url);
        const filePath = decodeURIComponent(url.pathname);

        if (!fs.existsSync(filePath)) {
          console.warn(`Organ image not found: ${filePath}`);
          return new Response('File not found', { status: 404 });
        }

        return net.fetch(pathToFileURL(filePath).toString());
      } catch (e) {
        console.error('Organ-img protocol error:', e);
        return new Response('Internal error', { status: 500 });
      }
    });

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
}
