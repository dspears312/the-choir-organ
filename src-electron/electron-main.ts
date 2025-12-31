import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url'
import { setImmediate } from 'timers';
import { exec } from 'child_process';
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

// Register tsunami protocol as privileged for media streaming
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
  }
]);

let mainWindow: BrowserWindow | undefined;
let isCancellationRequested = false;

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

ipcMain.handle('read-text-file', async (event, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`Failed to read text file: ${filePath}`, e);
    return null;
  }
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
      return net.fetch('file://' + filePath);
    } catch (e) {
      console.error('Tsunami protocol error:', e);
      return new Response('Error', { status: 500 });
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
