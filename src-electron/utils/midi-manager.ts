import { BrowserWindow } from 'electron';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Use require for the native module to be safe with ESM/Electron
const midi = require('midi');

export class MidiManager {
    private static instance: MidiManager;
    private input: any;
    private output: any;
    private mainWindow: BrowserWindow | undefined;
    private portName = 'The Choir Organ';
    private isInitialized = false;

    private constructor() {
        console.log('[MidiManager] Constructing instance...');
        try {
            this.input = new midi.Input();
            this.output = new midi.Output();
        } catch (e) {
            console.error('[MidiManager] Failed to instantiate midi Input/Output:', e);
        }
    }

    public static getInstance(): MidiManager {
        if (!MidiManager.instance) {
            MidiManager.instance = new MidiManager();
        }
        return MidiManager.instance;
    }

    public setMainWindow(window: BrowserWindow) {
        this.mainWindow = window;
        // If we haven't initialized yet, do it now that we have a window reference
        if (!this.isInitialized) {
            this.setupVirtualPort();
        }
    }

    public setupVirtualPort() {
        if (this.isInitialized) return;

        const platform = process.platform;
        console.log(`[MidiManager] Setting up virtual ports on platform: ${platform}`);

        if (platform === 'darwin' || platform === 'linux') {
            console.log(`[MidiManager] Attempting to create virtual MIDI input port: "${this.portName}"`);
            try {
                this.input.openVirtualPort(this.portName);
                this.input.on('message', (deltaTime: number, message: number[]) => {
                    this.handleMessage(message);
                });
                console.log(`[MidiManager] Virtual input port "${this.portName}" created successfully.`);
            } catch (e) {
                console.error(`[MidiManager] Failed to create virtual input port:`, e);
            }

            console.log(`[MidiManager] Attempting to create virtual MIDI output port: "${this.portName}"`);
            try {
                this.output.openVirtualPort(this.portName);
                console.log(`[MidiManager] Virtual output port "${this.portName}" created successfully.`);
            } catch (e) {
                console.error(`[MidiManager] Failed to create virtual output port:`, e);
            }
            this.isInitialized = true;
        } else if (platform === 'win32') {
            console.log(`[MidiManager] Virtual MIDI ports are not natively supported on Windows.`);
            this.listAvailablePorts();
            this.isInitialized = true;
        }
    }

    private listAvailablePorts() {
        try {
            const inputCount = this.input.getPortCount();
            console.log(`[MidiManager] Available Input Ports (${inputCount}):`);
            for (let i = 0; i < inputCount; i++) {
                console.log(`  ${i}: ${this.input.getPortName(i)}`);
            }

            const outputCount = this.output.getPortCount();
            console.log(`[MidiManager] Available Output Ports (${outputCount}):`);
            for (let i = 0; i < outputCount; i++) {
                console.log(`  ${i}: ${this.output.getPortName(i)}`);
            }
        } catch (e) {
            console.error('[MidiManager] Failed to list ports:', e);
        }
    }

    private handleMessage(message: number[]) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('virtual-midi-message', {
                data: message,
                timestamp: Date.now()
            });
        }
    }

    public close() {
        try {
            this.input.closePort();
            this.output.closePort();
        } catch (e) {
            // ignore
        }
    }
}

export const midiManager = MidiManager.getInstance();
