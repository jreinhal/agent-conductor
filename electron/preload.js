const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // App info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    // Update notifications
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, version) => callback(version));
    },

    // Window controls
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),

    // Platform info
    platform: process.platform,

    // Check if running in Electron
    isElectron: true
});
