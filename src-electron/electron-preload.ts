import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myApi', {
    selectOdfFile: (path?: string) => ipcRenderer.invoke('select-odf-file', path),
    renderBank: (args: any) => ipcRenderer.invoke('render-bank', args),
    cancelRendering: () => ipcRenderer.invoke('cancel-rendering'),
    readTextFile: (path: string) => ipcRenderer.invoke('read-text-file', path),
    readFileAsArrayBuffer: (path: string) => ipcRenderer.invoke('read-file-arraybuffer', path),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getWavInfo: (path: string) => ipcRenderer.invoke('get-wav-info', path),
    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    onRenderProgress: (callback: (event: any, progress: number) => void) => ipcRenderer.on('render-progress', callback),
    onExtractionProgress: (callback: (event: any, data: { progress: number, file: string }) => void) => ipcRenderer.on('extraction-progress', callback),
    onExtractionStart: (callback: (event: any) => void) => ipcRenderer.on('extraction-start', callback),
    listDir: (path: string) => ipcRenderer.invoke('list-dir', path),
    saveOrganState: (odfPath: string, state: any) => ipcRenderer.invoke('save-organ-state', { odfPath, state }),
    loadOrganState: (odfPath: string) => ipcRenderer.invoke('load-organ-state', odfPath),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getDiskInfo: (path: string) => ipcRenderer.invoke('get-disk-info', path),
    listRemovableDrives: () => ipcRenderer.invoke('list-removable-drives'),
    formatVolume: (path: string, label: string) => ipcRenderer.invoke('format-volume', { path, label }),
    openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),

    // Updates
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
    onUpdateAvailable: (callback: (info: any) => void) => {
        const listener = (_event: any, info: any) => callback(info);
        ipcRenderer.on('update-available', listener);
        return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateNotAvailable: (callback: (info: any) => void) => {
        const listener = (_event: any, info: any) => callback(info);
        ipcRenderer.on('update-not-available', listener);
        return () => ipcRenderer.removeListener('update-not-available', listener);
    },
    onUpdateDownloadProgress: (callback: (progress: any) => void) => {
        const listener = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('update-download-progress', listener);
        return () => ipcRenderer.removeListener('update-download-progress', listener);
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
        const listener = (_event: any, info: any) => callback(info);
        ipcRenderer.on('update-downloaded', listener);
        return () => ipcRenderer.removeListener('update-downloaded', listener);
    },
    onUpdateError: (callback: (error: string) => void) => {
        const listener = (_event: any, error: string) => callback(error);
        ipcRenderer.on('update-error', listener);
        return () => ipcRenderer.removeListener('update-error', listener);
    }
});
