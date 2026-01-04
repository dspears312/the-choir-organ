import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { WebSocketServer as WSSType, WebSocket as WSType } from 'ws';

const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require('ws');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WebServerStatus {
    running: boolean;
    port: number;
    ips: string[];
}

let server: http.Server | null = null;
let wss: WSSType | null = null;
let currentPort = 8080;
let currentOrganData: any = null;
let currentActivatedStops: string[] = [];
let serverInstanceId = 0;

export function getLocalIPs(): string[] {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

export let mainWindowInstance: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow) {
    mainWindowInstance = win;
    console.log('[WebRemote] Main window reference updated');
}

export function startWebServer(port: number = 8080) {
    if (server) {
        console.log('[WebRemote] Server instance already exists, forcing stop first');
        stopWebServer();
    }

    serverInstanceId++;
    const currentId = serverInstanceId;

    // Determine the remote dist directory
    const distPaths = [
        path.join(__dirname, '../remote/dist'),
        path.join(process.cwd(), 'src-electron/remote/dist'),
        path.join(process.resourcesPath, 'remote/dist')
    ];

    const distPath = distPaths.find(p => fs.existsSync(p)) || distPaths[1];
    if (!distPath) return { running: false, port, ips: getLocalIPs() };
    console.log(`[WebRemote][Instance ${currentId}] Using dist path:`, distPath);

    const isDev = process.env.DEV === 'true' || !process.env.PROD;
    const hmrTarget = process.env.REMOTE_HMR_URL || 'http://localhost:5173';

    currentPort = port;
    server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        let pathname = url.pathname;

        // HMR PROXY (in development mode)
        if (isDev && !pathname.startsWith('/organ-img/')) {
            const proxyReq = http.request(hmrTarget + pathname + (url.search || ''), {
                method: req.method,
                headers: req.headers
            }, (proxyRes) => {
                if (proxyRes.statusCode === 404) {
                    // If Vite doesn't have it, try our static fallback or image proxy
                    handleStaticRequest(pathname, req, res, distPath);
                    return;
                }
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                proxyRes.pipe(res);
            });

            proxyReq.on('error', (err) => {
                console.warn(`[WebRemote][Instance ${currentId}] HMR Proxy error (Vite likely not running):`, err.message);
                handleStaticRequest(pathname, req, res, distPath);
            });

            req.pipe(proxyReq);
            return;
        }

        handleStaticRequest(pathname, req, res, distPath);
    });

    function handleStaticRequest(pathname: string, req: http.IncomingMessage, res: http.ServerResponse, distPath: string) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        // Image Proxying (KEEP for actual organ assets)
        if (pathname.startsWith('/organ-img/')) {
            const filePath = decodeURIComponent(pathname.replace('/organ-img/', ''));
            if (fs.existsSync(filePath)) {
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.bmp': 'image/bmp',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml'
                };
                res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404);
                res.end('Image not found');
            }
            return;
        }

        const fullPath = distPath ? path.join(distPath, pathname) : '';
        if (fullPath && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(fullPath).toLowerCase();
            const mimeTypes: Record<string, string> = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon'
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            fs.createReadStream(fullPath).pipe(res);
            return;
        }

        // FALLBACK: Serve index.html for SPA routing if needed (though not using router yet)
        const indexPath = distPath ? path.join(distPath, 'index.html') : '';
        if (indexPath && fs.existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(indexPath).pipe(res);
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    }

    wss = new WebSocketServer({ server });

    if (wss) {
        wss.on('connection', (ws: WSType) => {
            console.log(`[WebRemote][Instance ${currentId}] Client connected. Organ:`, currentOrganData?.name);

            // Send initial state
            const initState = JSON.stringify({
                type: 'tco-init',
                organData: currentOrganData,
                activatedStops: currentActivatedStops,
                screens: currentOrganData?.screens || [],
                activeScreenIndex: currentOrganData?.activeScreenIndex || 0,
                ...currentExtraState
            });

            ws.send(initState, (err) => {
                if (err) console.error(`[WebRemote][Instance ${currentId}] Error sending init state:`, err);
                else console.log(`[WebRemote][Instance ${currentId}] Init state sent successfully`);
            });

            ws.on('message', (message: any) => {
                try {
                    const data = JSON.parse(message.toString());
                    console.log(`[WebRemote][Instance ${currentId}] Received message:`, data.type);
                    if (data.type === 'toggleStop') {
                        // Forward to renderer
                        if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                            mainWindowInstance.webContents.send('remote-toggle-stop', data.stopId);
                        } else {
                            console.warn(`[WebRemote][Instance ${currentId}] Cannot forward toggleStop: Main window not ready`);
                        }
                    } else if (data.type === 'clearCombination') {
                        // Forward to renderer
                        if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                            mainWindowInstance.webContents.send('remote-clear-combination');
                        } else {
                            console.warn(`[WebRemote][Instance ${currentId}] Cannot forward clearCombination: Main window not ready`);
                        }
                    } else if (['loadBank', 'saveToBank', 'addBank', 'deleteBank', 'moveBank', 'deleteRecording', 'setStopVolume', 'toggleRecording'].includes(data.type)) {
                        // Forward generic commands to renderer
                        if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                            mainWindowInstance.webContents.send(`remote-${data.type}`, data);
                        } else {
                            console.warn(`[WebRemote][Instance ${currentId}] Cannot forward ${data.type}: Main window not ready`);
                        }
                    }
                } catch (e) {
                    console.error(`[WebRemote][Instance ${currentId}] Error parsing message:`, e);
                }
            });

            ws.on('error', (err) => {
                console.error(`[WebRemote][Instance ${currentId}] WebSocket error:`, err);
            });

            ws.on('close', () => {
                console.log(`[WebRemote][Instance ${currentId}] Client disconnected`);
            });
        });
    }

    server.listen(port, '0.0.0.0', () => {
        console.log(`[WebRemote][Instance ${currentId}] Listening on http://0.0.0.0:${port}`);
    });

    console.log(`[WebRemote][Instance ${currentId}] Server started successfully on port ${port}`);

    return {
        running: true,
        port: currentPort,
        ips: getLocalIPs()
    };
}

export function stopWebServer() {
    const currentId = serverInstanceId;
    console.log(`[WebRemote] Stopping server instance ${currentId}...`);

    if (wss) {
        const clientCount = wss.clients.size;
        console.log(`[WebRemote][Instance ${currentId}] Terminating ${clientCount} clients`);
        wss.clients.forEach((client: any) => {
            try {
                client.terminate();
            } catch (e) { /* ignore */ }
        });
        wss.close(() => {
            console.log(`[WebRemote][Instance ${currentId}] WSS closed`);
        });
        wss = null;
    }

    if (server) {
        server.close((err) => {
            if (err) console.error(`[WebRemote][Instance ${currentId}] HTTP Close Error:`, err);
            else console.log(`[WebRemote][Instance ${currentId}] HTTP server closed`);
        });
        server = null;
    }

    console.log(`[WebRemote][Instance ${currentId}] Instance pointers cleared`);
    return {
        running: false,
        port: currentPort,
        ips: getLocalIPs()
    };
}

let currentExtraState: any = {};

export function updateRemoteState(organData: any, activatedStops: string[], extra: any = {}) {
    const currentId = serverInstanceId;
    console.log(`[WebRemote][Instance ${currentId}] Updating state. Organ:`, organData?.name, 'Stops:', activatedStops?.length);
    currentOrganData = organData;
    currentActivatedStops = activatedStops;
    currentExtraState = extra;

    if (wss) {
        const message = JSON.stringify({
            type: 'tco-update',
            organData: currentOrganData,
            activatedStops: currentActivatedStops,
            screens: currentOrganData?.screens || [],
            activeScreenIndex: currentOrganData?.activeScreenIndex || 0,
            ...currentExtraState
        });
        wss.clients.forEach((client: any) => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(message);
            }
        });
    }
}

export function getWebServerStatus(): WebServerStatus {
    const status = {
        running: server !== null,
        port: currentPort,
        ips: getLocalIPs()
    };
    console.log('[WebRemote] Get status:', status.running);
    return status;
}
