import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myApi', {
    selectOdfFile: (path?: string) => ipcRenderer.invoke('select-odf-file', path),
    renderBank: (args: any) => ipcRenderer.invoke('render-bank', args),
    renderPerformance: (recording: any, organData: any, renderTails: boolean) => ipcRenderer.invoke('render-performance', { recording, organData, renderTails }),
    cancelRendering: () => ipcRenderer.invoke('cancel-rendering'),
    readTextFile: (path: string) => ipcRenderer.invoke('read-text-file', path),
    readFileAsArrayBuffer: (path: string) => ipcRenderer.invoke('read-file-arraybuffer', path),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getWavInfo: (path: string) => ipcRenderer.invoke('get-wav-info', path),
    getWavSamples: (path: string, maxSamples?: number) => ipcRenderer.invoke('get-wav-samples', path, maxSamples),
    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    onRenderProgress: (callback: (event: any, progress: number) => void) => {
        const listener = (event: any, progress: number) => callback(event, progress);
        ipcRenderer.on('render-progress', listener);
        return () => ipcRenderer.removeListener('render-progress', listener);
    },
    onExtractionProgress: (callback: (event: any, data: { progress: number, file: string }) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('extraction-progress', listener);
        return () => ipcRenderer.removeListener('extraction-progress', listener);
    },
    onExtractionStart: (callback: (event: any) => void) => {
        const listener = (event: any) => callback(event);
        ipcRenderer.on('extraction-start', listener);
        return () => ipcRenderer.removeListener('extraction-start', listener);
    },
    listDir: (path: string) => ipcRenderer.invoke('list-dir', path),
    saveOrganState: (odfPath: string, state: any) => ipcRenderer.invoke('save-organ-state', odfPath, state),
    loadOrganState: (odfPath: string) => ipcRenderer.invoke('load-organ-state', odfPath),
    saveMidiFile: (buffer: ArrayBuffer, filename: string) => ipcRenderer.invoke('save-midi-file', { buffer, filename }),
    openMidiFile: () => ipcRenderer.invoke('open-midi-file'),
    parseOdf: (odfPath: string) => ipcRenderer.invoke('parse-odf', odfPath),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getDiskInfo: (path: string) => ipcRenderer.invoke('get-disk-info', path),
    listRemovableDrives: () => ipcRenderer.invoke('list-removable-drives'),
    formatVolume: (path: string, label: string) => ipcRenderer.invoke('format-volume', { path, label }),
    openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
    removeFromRecent: (path: string) => ipcRenderer.invoke('remove-from-recent', path),
    calculateOrganSize: (path: string) => ipcRenderer.invoke('calculate-organ-size', path),
    deleteOrganFiles: (path: string) => ipcRenderer.invoke('delete-organ-files', path),

    loadUserSettings: () => ipcRenderer.invoke('load-user-settings'),
    saveUserSettings: (settings: any) => ipcRenderer.invoke('save-user-settings', settings),

    // Remote Control
    startWebServer: (port: number) => ipcRenderer.invoke('start-web-server', port),
    stopWebServer: () => ipcRenderer.invoke('stop-web-server'),
    getWebServerStatus: () => ipcRenderer.invoke('get-web-server-status'),
    updateRemoteState: (state: any) => ipcRenderer.invoke('update-remote-state', state),
    onRemoteToggleStop: (callback: (event: any, stopId: string) => void) => {
        const listener = (event: any, stopId: string) => callback(event, stopId);
        ipcRenderer.on('remote-toggle-stop', listener);
        return () => ipcRenderer.removeListener('remote-toggle-stop', listener);
    },
    onRemoteClearCombination: (callback: (event: any) => void) => {
        const listener = (event: any) => callback(event);
        ipcRenderer.on('remote-clear-combination', listener);
        return () => ipcRenderer.removeListener('remote-clear-combination', listener);
    },
    onRemoteLoadBank: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-loadBank', listener);
        return () => ipcRenderer.removeListener('remote-loadBank', listener);
    },
    onRemoteSaveToBank: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-saveToBank', listener);
        return () => ipcRenderer.removeListener('remote-saveToBank', listener);
    },
    onRemoteAddBank: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-addBank', listener);
        return () => ipcRenderer.removeListener('remote-addBank', listener);
    },
    onRemoteDeleteBank: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-deleteBank', listener);
        return () => ipcRenderer.removeListener('remote-deleteBank', listener);
    },
    onRemoteMoveBank: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-moveBank', listener);
        return () => ipcRenderer.removeListener('remote-moveBank', listener);
    },
    onRemoteDeleteRecording: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-deleteRecording', listener);
        return () => ipcRenderer.removeListener('remote-deleteRecording', listener);
    },
    onRemoteSetStopVolume: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-setStopVolume', listener);
        return () => ipcRenderer.removeListener('remote-setStopVolume', listener);
    },
    onRemoteToggleRecording: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-toggleRecording', listener);
        return () => ipcRenderer.removeListener('remote-toggleRecording', listener);
    },
    onRemotePlayRecording: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-playRecording', listener);
        return () => ipcRenderer.removeListener('remote-playRecording', listener);
    },
    onRemoteStopPlayback: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('remote-stopPlayback', listener);
        return () => ipcRenderer.removeListener('remote-stopPlayback', listener);
    },

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
    },

    // System Stats
    onMemoryUpdate: (callback: (bytes: number) => void) => {
        const listener = (_event: any, bytes: number) => callback(bytes);
        ipcRenderer.on('memory-update', listener);
        return () => ipcRenderer.removeListener('memory-update', listener);
    },

    // Worker IPC
    createWorkers: (count: number) => ipcRenderer.invoke('create-workers', count),
    onWorkerInit: (callback: (event: any) => void) => {
        const listener = (event: any) => callback(event);
        ipcRenderer.on('worker-init', listener);
        return () => ipcRenderer.removeListener('worker-init', listener);
    },
    onWorkerCommand: (callback: (command: any) => void) => {
        const listener = (_event: any, command: any) => callback(command);
        ipcRenderer.on('worker-command', listener);
        return () => ipcRenderer.removeListener('worker-command', listener);
    },
    sendWorkerCommand: (workerIndex: number, command: any) => ipcRenderer.send('send-worker-command', { workerIndex, command }),
    logToMain: (msg: string) => ipcRenderer.send('worker-log', msg),
    notifyWorkerReady: () => ipcRenderer.send('worker-ready'),
    onWorkerReady: (callback: (workerIndex: number) => void) => {
        const listener = (_event: any, workerIndex: number) => callback(workerIndex);
        ipcRenderer.on('worker-ready', listener);
        return () => ipcRenderer.removeListener('worker-ready', listener);
    },

    sendWorkerStats: (stats: any) => ipcRenderer.send('worker-stats', stats),
    onWorkerStats: (callback: (event: any, stats: any) => void) => {
        const listener = (event: any, stats: any) => callback(event, stats);
        ipcRenderer.on('worker-stats', listener);
        return () => ipcRenderer.removeListener('worker-stats', listener);
    },
    sendSampleLoaded: (data: any) => ipcRenderer.send('sample-loaded', data),
    onSampleLoaded: (callback: (event: any, data: any) => void) => {
        const listener = (event: any, data: any) => callback(event, data);
        ipcRenderer.on('sample-loaded', listener);
        return () => ipcRenderer.removeListener('sample-loaded', listener);
    },
    onSampleLoadedBatch: (callback: (event: any, count: number) => void) => {
        const listener = (event: any, count: number) => callback(event, count);
        ipcRenderer.on('sample-loaded-batch', listener);
        return () => ipcRenderer.removeListener('sample-loaded-batch', listener);
    },
    resetProgressBuffer: () => ipcRenderer.invoke('reset-progress-buffer'),
    getProcessMemoryUsage: () => Promise.resolve(process.memoryUsage()),

    // Window Controls
    platform: process.platform,
    minimize: () => ipcRenderer.send('window-minimize'),
    toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
    close: () => ipcRenderer.send('window-close')
});
