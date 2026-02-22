const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

// Conditionally load electron-store and electron-updater (may not be available in dev)
let Store, autoUpdater;
try {
    const electronStoreModule = require('electron-store');
    Store = typeof electronStoreModule === 'function'
        ? electronStoreModule
        : electronStoreModule?.default;
    if (typeof Store !== 'function') {
        Store = undefined;
        console.warn('electron-store loaded but constructor export was not found; window state persistence disabled.');
    }
} catch (e) {
    console.log('electron-store unavailable; window state persistence disabled.');
}

try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    console.log('electron-updater unavailable; auto-update disabled.');
}

let mainWindow;
let serverProcess;
let tray = null;
let PORT = 3000;

// Initialize store for window state persistence
let store;
if (Store) {
    try {
        store = new Store({
            defaults: {
                windowBounds: { width: 1280, height: 800 },
                windowPosition: null,
                windowMaximized: false,
            }
        });
    } catch (error) {
        console.warn('Failed to initialize electron-store; continuing without persisted window state.', error?.message || error);
        store = null;
    }
}

// Function to find a free port
const findFreePort = (startPort) => {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(findFreePort(startPort + 1));
            } else {
                reject(err);
            }
        });
    });
};

// Wait for server to be ready
const waitForServer = (port, maxAttempts = 30) => {
    return new Promise((resolve, reject) => {
        let attempts = 0;

        const checkServer = () => {
            attempts++;
            const req = http.request({
                hostname: 'localhost',
                port: port,
                path: '/',
                method: 'HEAD',
                timeout: 1000
            }, (res) => {
                resolve(true);
            });

            req.on('error', () => {
                if (attempts < maxAttempts) {
                    setTimeout(checkServer, 500);
                } else {
                    reject(new Error('Server failed to start'));
                }
            });

            req.on('timeout', () => {
                req.destroy();
                if (attempts < maxAttempts) {
                    setTimeout(checkServer, 500);
                } else {
                    reject(new Error('Server startup timeout'));
                }
            });

            req.end();
        };

        checkServer();
    });
};

const startServer = async () => {
    PORT = await findFreePort(3000);
    console.log(`Starting local server on port ${PORT}...`);

    const standaloneRoot = path.join(__dirname, '../.next/standalone');
    const directServerPath = path.join(standaloneRoot, 'server.js');

    let scriptPath = directServerPath;
    let serverCwd = standaloneRoot;

    if (!fs.existsSync(directServerPath)) {
        const nestedDir = fs.existsSync(standaloneRoot)
            ? fs.readdirSync(standaloneRoot, { withFileTypes: true })
                .find((entry) => entry.isDirectory() && fs.existsSync(path.join(standaloneRoot, entry.name, 'server.js')))
            : null;

        if (nestedDir) {
            serverCwd = path.join(standaloneRoot, nestedDir.name);
            scriptPath = path.join(serverCwd, 'server.js');
        }
    }

    if (!fs.existsSync(scriptPath)) {
        throw new Error(`Standalone server entrypoint not found. Expected server.js under ${standaloneRoot}`);
    }

    const staticSource = path.join(__dirname, '../.next/static');
    const staticTarget = path.join(serverCwd, '.next/static');
    if (fs.existsSync(staticSource) && !fs.existsSync(staticTarget)) {
        fs.mkdirSync(path.dirname(staticTarget), { recursive: true });
        fs.cpSync(staticSource, staticTarget, { recursive: true });
        console.log(`[Server]: copied static assets to ${staticTarget}`);
    }

    serverProcess = spawn('node', [scriptPath], {
        cwd: serverCwd,
        env: { ...process.env, PORT: PORT, NODE_ENV: 'production' },
        stdio: 'pipe'
    });

    // Capture server output for debugging
    serverProcess.stdout.on('data', (data) => {
        console.log(`[Server]: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`[Server Error]: ${data}`);
    });

    serverProcess.on('error', (err) => {
        console.error('Failed to start server:', err);
    });

    serverProcess.on('close', (code) => {
        console.log(`Server process exited with code ${code}`);
    });

    // Wait for server to be ready
    try {
        await waitForServer(PORT);
        console.log('Server is ready!');
    } catch (err) {
        console.error('Server failed to become ready:', err);
    }
};

const createTray = () => {
    // Create a simple tray icon (16x16 colored square)
    const icon = nativeImage.createEmpty();

    // Try to load an icon file, or use a default
    const iconPath = path.join(__dirname, '../public/icon.png');
    try {
        tray = new Tray(iconPath);
    } catch (e) {
        // Create a simple colored icon if no file exists
        tray = new Tray(nativeImage.createFromDataURL(
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABSSURBVDiNY2AYBaNgFIwCGDBCMQMDA8N/BgYGRgYGhv8MDAwMjFAFjAwMDP+R5BkZGBj+E9JMrOaRYQAjsgHoBqCLk2TAaF4YBaNgFIyCEQMAAN0LBxrIZlwAAAAASUVORK5CYII='
        ));
    }

    tray.setToolTip('Agent Conductor');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Agent Conductor',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Check for Updates',
            click: () => {
                if (autoUpdater) {
                    autoUpdater.checkForUpdatesAndNotify();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
};

const createWindow = () => {
    // Restore window bounds from store
    const savedBounds = store ? store.get('windowBounds') : { width: 1280, height: 800 };
    const savedPosition = store ? store.get('windowPosition') : null;
    const wasMaximized = store ? store.get('windowMaximized') : false;

    const windowOptions = {
        width: savedBounds.width,
        height: savedBounds.height,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        show: false, // Don't show until ready
        backgroundColor: '#ffffff',
        title: 'Agent Conductor'
    };

    if (savedPosition) {
        windowOptions.x = savedPosition.x;
        windowOptions.y = savedPosition.y;
    }

    mainWindow = new BrowserWindow(windowOptions);

    // Restore maximized state
    if (wasMaximized) {
        mainWindow.maximize();
    }

    // Save window state on changes
    const saveWindowState = () => {
        if (!mainWindow || !store) return;

        const isMaximized = mainWindow.isMaximized();
        store.set('windowMaximized', isMaximized);

        if (!isMaximized) {
            const bounds = mainWindow.getBounds();
            store.set('windowBounds', { width: bounds.width, height: bounds.height });
            store.set('windowPosition', { x: bounds.x, y: bounds.y });
        }
    };

    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);
    mainWindow.on('maximize', saveWindowState);
    mainWindow.on('unmaximize', saveWindowState);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Load the app
    mainWindow.loadURL(`http://localhost:${PORT}`);

    // Handle load errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`Failed to load: ${errorDescription} (${errorCode})`);
        // Retry after a short delay
        setTimeout(() => {
            mainWindow.loadURL(`http://localhost:${PORT}`);
        }, 2000);
    });

    mainWindow.on('close', (event) => {
        // Minimize to tray instead of closing (on non-macOS)
        if (!app.isQuitting && process.platform !== 'darwin') {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
};

const setupAutoUpdater = () => {
    if (!autoUpdater) return;

    autoUpdater.logger = console;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version);
    });

    autoUpdater.on('update-not-available', () => {
        console.log('No updates available');
    });

    autoUpdater.on('error', (err) => {
        console.error('Auto-updater error:', err);
    });

    autoUpdater.on('download-progress', (progress) => {
        console.log(`Download progress: ${progress.percent.toFixed(1)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded:', info.version);
        // Notify user through the main window
        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', info.version);
        }
    });

    // Check for updates on startup (with delay)
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 5000);
};

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.on('ready', async () => {
        // Start the Next.js server
        if (process.env.NODE_ENV !== 'development') {
            await startServer();
        } else {
            // In dev, assume the server is already running
            PORT = 3000;
        }

        createWindow();
        createTray();
        setupAutoUpdater();
    });

    app.on('window-all-closed', () => {
        // On macOS, keep the app running in the menu bar
        if (process.platform !== 'darwin') {
            // Don't quit - we're minimized to tray
        }
    });

    app.on('before-quit', () => {
        app.isQuitting = true;
    });

    app.on('will-quit', () => {
        if (serverProcess) {
            serverProcess.kill();
        }
        if (tray) {
            tray.destroy();
        }
    });

    app.on('activate', () => {
        if (mainWindow === null) {
            createWindow();
        } else {
            mainWindow.show();
        }
    });
}
