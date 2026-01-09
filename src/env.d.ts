/* eslint-disable */

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined;
    VUE_ROUTER_BASE: string | undefined;
  }
}

export interface IElectronAPI {
  selectOdfFile: (path?: string) => Promise<any>;
  renderBank: (args: any) => Promise<any>;
  readFileAsArrayBuffer: (path: string) => Promise<ArrayBuffer>;
  selectFolder: () => Promise<string | null>;
  getWavInfo: (path: string) => Promise<any>;
  getWavSamples: (path: string, maxSamples?: number) => Promise<any>;
  getRecentFiles: () => Promise<string[]>;
  onRenderProgress: (callback: (event: any, progress: any) => void) => () => void;
  onExtractionProgress: (callback: (event: any, data: { progress: number, file: string }) => void) => () => void;
  onExtractionStart: (callback: (event: any) => void) => () => void;
  listDir: (path: string) => Promise<string[]>;
  saveOrganState: (odfPath: string, state: any) => Promise<void>;
  loadUserSettings: () => Promise<any>;
  saveUserSettings: (settings: any) => Promise<void>;
  parseOdf: (odfPath: string) => Promise<any>;
  loadOrganState: (odfPath: string) => Promise<any>;
  renderPerformance: (recording: any, organData: any, renderTails: boolean) => Promise<any>;
  saveMidiFile: (buffer: ArrayBuffer, filename: string) => Promise<any>;
  openMidiFile: () => Promise<{ buffer: ArrayBuffer, filename: string } | { canceled: true } | { error: string }>;
  cancelRendering: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getDiskInfo: (path: string) => Promise<any>;
  listRemovableDrives: () => Promise<any[]>;
  formatVolume: (path: string, label: string) => Promise<any>;
  openExternalUrl: (url: string) => Promise<void>;
  removeFromRecent: (path: string) => Promise<void>;
  calculateOrganSize: (path: string) => Promise<any>;
  deleteOrganFiles: (path: string) => Promise<any>;
  deleteOrganCache: (path: string) => Promise<boolean>;
  deleteOrganSave: (path: string) => Promise<boolean>;
  triggerGC: () => Promise<void>;

  // Remote Control
  startWebServer: (port: number) => Promise<any>;
  stopWebServer: () => Promise<any>;
  getWebServerStatus: () => Promise<any>;
  updateRemoteState: (state: any) => Promise<void>;
  onRemoteToggleStop: (callback: (event: any, stopId: string) => void) => () => void;
  onRemoteClearCombination: (callback: (event: any) => void) => () => void;
  onRemoteLoadBank: (callback: (event: any, data: any) => void) => () => void;
  onRemoteSaveToBank: (callback: (event: any, data: any) => void) => () => void;
  onRemoteAddBank: (callback: (event: any, data: any) => void) => () => void;
  onRemoteDeleteBank: (callback: (event: any, data: any) => void) => () => void;
  onRemoteMoveBank: (callback: (event: any, data: any) => void) => () => void;
  onRemoteDeleteRecording: (callback: (event: any, data: any) => void) => () => void;
  onRemoteSetStopVolume: (callback: (event: any, data: any) => void) => () => void;
  onRemoteToggleRecording: (callback: (event: any, data: any) => void) => () => void;
  onRemotePlayRecording: (callback: (event: any, data: any) => void) => () => void;
  onRemoteStopPlayback: (callback: (event: any, data: any) => void) => () => void;
  onRemoteServerError: (callback: (message: string) => void) => () => void;

  // Updates
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<any>;
  quitAndInstall: () => Promise<any>;

  // Worker IPC
  createWorkers: (count: number) => Promise<void>;
  sendWorkerCommand: (workerIndex: number, command: any) => void;
  onWorkerInit: (callback: (event: any) => void) => () => void;
  onWorkerCommand: (callback: (command: any) => void) => () => void;
  sendWorkerStats: (stats: any) => void;
  onWorkerStats: (callback: (event: any, stats: any) => void) => () => void;
  getProcessMemoryUsage: () => Promise<any>;
  logToMain: (msg: string) => void;
  notifyWorkerReady: () => void;
  onWorkerReady: (callback: (workerIndex: number) => void) => () => void;
  sendSampleLoaded: (data: any) => void;
  onSampleLoaded: (callback: (event: any, data: any) => void) => () => void;
  onSampleLoadedBatch: (callback: (event: any, count: number) => void) => () => void;
  resetProgressBuffer: () => Promise<void>;

  // Window Controls
  platform: string;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  onWindowStateChanged?: (callback: (state: string) => void) => () => void;
  onDevToolsChange?: (callback: (isOpen: boolean) => void) => () => void;
  isDevToolsOpened?: () => Promise<boolean>;
  onVirtualMidiMessage: (callback: (event: any, data: { data: number[], timestamp: number }) => void) => () => void;
}

declare global {
  interface Window {
    myApi: IElectronAPI;
  }
}
