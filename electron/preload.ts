import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload script — exposes a safe IPC bridge to the renderer.
 *
 * This replaces Tauri's invoke/listen APIs. The renderer accesses these
 * methods via `window.electronAPI`, and the electron-bridge.ts maps them
 * to the same TauriBridge interface the reactive engine expects.
 */
contextBridge.exposeInMainWorld("electronAPI", {
  // Request/response commands (replaces Tauri invoke)
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  // Push event listeners (replaces Tauri listen)
  onLcuEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("lcu-event", handler);
    return () => ipcRenderer.removeListener("lcu-event", handler);
  },

  onLcuDisconnect: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("lcu-disconnect", handler);
    return () => ipcRenderer.removeListener("lcu-disconnect", handler);
  },

  onHotkeyEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("hotkey-event", handler);
    return () => ipcRenderer.removeListener("hotkey-event", handler);
  },
});
