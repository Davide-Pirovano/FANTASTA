const { contextBridge, ipcRenderer } = require("electron");

// Bridge intenzionalmente minimo: nessun accesso a filesystem, shell o IPC generico.
contextBridge.exposeInMainWorld("fantastaDesktop", {
  platform: process.platform,
  saveHostConfig: (config) => ipcRenderer.invoke("fantasta:save-host-config", config),
  exportBackup: () => ipcRenderer.invoke("fantasta:export-backup"),
  restoreBackup: () => ipcRenderer.invoke("fantasta:restore-backup"),
});
