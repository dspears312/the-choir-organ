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
  getRecentFiles: () => Promise<string[]>;
  onRenderProgress: (callback: (event: any, progress: number) => void) => void;
  listDir: (path: string) => Promise<string[]>;
  saveOrganState: (odfPath: string, state: any) => Promise<void>;
  loadOrganState: (odfPath: string) => Promise<any>;
}

declare global {
  interface Window {
    myApi: IElectronAPI;
  }
}
