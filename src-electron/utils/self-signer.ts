import { app, dialog } from 'electron';
import { exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Checks if the current application bundle has the com.apple.quarantine attribute.
 * Only works on macOS.
 */
export async function isAppQuarantined(): Promise<boolean> {
    if (process.platform !== 'darwin') return false;

    const appPath = getAppBundlePath();
    if (!appPath) return false;

    return new Promise((resolve) => {
        exec(`xattr -p com.apple.quarantine "${appPath}"`, (error) => {
            // If xattr returns 0, the attribute exists (quarantined). 
            // If it returns non-zero (or prints nothing to stdout usually accompanied by error), it's not.
            if (!error) {
                resolve(true); // Attribute found
            } else {
                resolve(false); // Not found or error
            }
        });
    });
}

/**
 * Helper to find the .app bundle path.
 * In a production Electron app, app.getAppPath() usually points to .../Contents/Resources/app.asar
 * We need to go up to .../The Choir Organ.app
 */
function getAppBundlePath(): string | null {
    const p = app.getPath('exe'); // This points to the detailed executable inside Contents/MacOS
    // e.g. /Applications/The Choir Organ.app/Contents/MacOS/The Choir Organ

    // We want /Applications/The Choir Organ.app
    // So we look for the .app extension in the path parts

    if (!p.includes('.app/')) return null; // Not running from a bundle?

    const parts = p.split(path.sep);
    const appIndex = parts.findIndex(part => part.endsWith('.app'));

    if (appIndex === -1) return null;

    return parts.slice(0, appIndex + 1).join(path.sep);
}

/**
 * Executes the self-repair process:
 * 1. Spawns a detached shell script.
 * 2. Script waits for this PID to die.
 * 3. Script runs xattr cleanup and codesign.
 * 4. Script attempts to re-open the app.
 */
export function performSelfRepair() {
    const appPath = getAppBundlePath();
    if (!appPath) {
        console.error('SelfRepair: Could not locate .app bundle.');
        return;
    }

    console.log('SelfRepair: Starting repair for', appPath);

    // We will run this script in a detached process
    const script = `
    echo "Waiting for PID ${process.pid} to exit..."
    while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done
    
    echo "Repairing ${appPath}..."
    xattr -dr com.apple.quarantine "${appPath}"
    codesign --force --deep --sign - --timestamp=none "${appPath}"
    codesign --verify --deep --strict --verbose=4 "${appPath}"
    
    echo "Relaunching..."
    open "${appPath}"
  `;

    const child = spawn('/bin/sh', ['-c', script], {
        detached: true,
        stdio: 'ignore'
    });

    child.unref();
    app.quit();
}

export async function checkAndPromptForSelfRepair(mainWindow: Electron.BrowserWindow | undefined) {
    if (process.platform !== 'darwin') return;

    // Only run this check if we are PACKAGED (production build), 
    // because in dev mode we are just running a node process, not a bundle that needs signing usually.
    if (!app.isPackaged) return;

    const quarantined = await isAppQuarantined();
    if (quarantined) {
        const response = await dialog.showMessageBox({
            type: 'warning',
            title: 'Security Validation Issue',
            message: 'This application appears to be running with restricted permissions (quarantine). This may prevent audio features from working correctly.',
            detail: 'Would you like to perform an automated self-repair? The application will close and restart.',
            buttons: ['Repair & Restart', 'Ignore'],
            defaultId: 0,
            cancelId: 1
        });

        if (response.response === 0) {
            performSelfRepair();
        }
    }
}
