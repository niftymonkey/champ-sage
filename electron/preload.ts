import { contextBridge, ipcRenderer } from "electron";

// electron-log preload — sets up IPC bridge for renderer → main log transport
import "electron-log/preload";

/**
 * Preload script — exposes a safe IPC bridge to the renderer.
 *
 * Channels:
 * - invoke: request/response commands (LCU discovery, fetch)
 * - onLcuEvent/onLcuDisconnect: LCU WebSocket push events
 * - onHotkeyEvent: push-to-talk hotkey (renderer keydown/keyup in Phase 1,
 *   overlay.hotkeys in ow-electron)
 * - onGepInfoUpdate/onGepGameEvent: GEP augment detection events
 * - onOverlayStatus: overlay injection state
 */
contextBridge.exposeInMainWorld("electronAPI", {
  // Request/response commands
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  // LCU WebSocket events
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

  // Push-to-talk hotkey events
  onHotkeyEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("hotkey-event", handler);
    return () => ipcRenderer.removeListener("hotkey-event", handler);
  },

  // GEP events (augment detection, game state)
  onGepInfoUpdate: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("gep-info-update", handler);
    return () => ipcRenderer.removeListener("gep-info-update", handler);
  },

  onGepGameEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("gep-game-event", handler);
    return () => ipcRenderer.removeListener("gep-game-event", handler);
  },

  // Overlay injection status
  onOverlayStatus: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("overlay-status", handler);
    return () => ipcRenderer.removeListener("overlay-status", handler);
  },

  // F8 calibration capture hotkey
  onCalibrationCapture: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("calibration-capture", handler);
    return () => ipcRenderer.removeListener("calibration-capture", handler);
  },

  // Overlay edit mode (Tab hold)
  onOverlayEditMode: (callback: (data: { editing: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload as { editing: boolean });
    ipcRenderer.on("overlay-edit-mode", handler);
    return () => ipcRenderer.removeListener("overlay-edit-mode", handler);
  },

  // Coaching strip drag
  startStripDrag: () => {
    ipcRenderer.send("start-strip-drag");
  },

  // Coaching request/response relay (desktop window → main → overlay)
  sendCoachingRequest: () => {
    ipcRenderer.send("coaching-request");
  },

  onCoachingRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("coaching-request", handler);
    return () => ipcRenderer.removeListener("coaching-request", handler);
  },

  sendCoachingResponse: (data: unknown) => {
    ipcRenderer.send("coaching-response", data);
  },

  onCoachingResponse: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("coaching-response", handler);
    return () => ipcRenderer.removeListener("coaching-response", handler);
  },
});
