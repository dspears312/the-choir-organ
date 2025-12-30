import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myApi', {
    selectOdfFile: (path?: string) => ipcRenderer.invoke('select-odf-file', path),
    renderBank: (args: any) => ipcRenderer.invoke('render-bank', args),
    cancelRendering: () => ipcRenderer.invoke('cancel-rendering'),
    readFileAsArrayBuffer: (path: string) => ipcRenderer.invoke('read-file-arraybuffer', path),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getWavInfo: (path: string) => ipcRenderer.invoke('get-wav-info', path),
    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    onRenderProgress: (callback: (event: any, progress: number) => void) => ipcRenderer.on('render-progress', callback),
    listDir: (path: string) => ipcRenderer.invoke('list-dir', path),
    saveOrganState: (odfPath: string, state: any) => ipcRenderer.invoke('save-organ-state', { odfPath, state }),
    loadOrganState: (odfPath: string) => ipcRenderer.invoke('load-organ-state', odfPath)
});
