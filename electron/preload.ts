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

  // GEP pre-queue health verdict (augments will/won't attach this game)
  onGepHealth: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("gep-health", handler);
    return () => ipcRenderer.removeListener("gep-health", handler);
  },

  // Pull the current GEP health verdict (the `ready` event that produces it
  // can fire before the renderer subscribes).
  getGepHealth: () => ipcRenderer.invoke("gep:get-health"),

  // "Restart now" from the update banner: relaunch to load the latest GEP.
  restartToUpdate: () => ipcRenderer.send("gep:restart-to-update"),

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

  // Coaching strip auto-resize: the strip is a frameless transparent
  // window with no OS-level resize handles. The renderer measures the
  // active card's content height after every state change and asks main
  // to fit the window to it. Width is fixed; height grows/shrinks.
  resizeStripToContent: (contentHeight: number) => {
    ipcRenderer.send("resize-strip-to-content", contentHeight);
  },

  // Coaching strip manual resize: when the user drags the corner grip in
  // edit mode, the renderer fires this with the desired absolute width and
  // height. Main applies it via setBounds AND latches a "user has set the
  // size" flag so subsequent auto-fit requests are ignored.
  setStripSize: (width: number, height: number) => {
    ipcRenderer.send("set-strip-size", { width, height });
  },

  // Coaching strip auto-fit reset: re-enables content-driven sizing after
  // the user has manually sized the strip. Used by the Clear Overlays
  // escape hatch; future affordance could surface this in Settings.
  resetStripSize: () => {
    ipcRenderer.send("reset-strip-size");
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

  // Overlay compositor flush — renderer asks main to force the overlay
  // window to repaint after a state-hidden transition (#111). React
  // unmounts the DOM fine, but ow-electron's compositor retains the
  // last-painted frame without a main-process nudge.
  requestOverlayFlush: (label: "badge" | "strip") => {
    ipcRenderer.send("request-overlay-flush", label);
  },

  // Clear overlays — app window or hotkey asks main to reset overlay
  // state machines and flush. Main broadcasts `clear-overlays` to every
  // renderer.
  clearOverlays: () => {
    ipcRenderer.send("clear-overlays");
  },

  onClearOverlays: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("clear-overlays", handler);
    return () => ipcRenderer.removeListener("clear-overlays", handler);
  },

  // Coach decision log query (renderer reads from main's persistent log).
  // Main owns the writer side via the existing coaching-response IPC tap;
  // renderer only reads via this typed wrapper around `invoke`.
  decisionLogQuery: (query: unknown) =>
    ipcRenderer.invoke("decision-log:query", query),

  // Fires after main successfully appends a coaching record to the
  // decision log. Renderer-side query hooks subscribe so they can
  // refetch without waiting on a tab toggle.
  onDecisionLogUpdated: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback(payload);
    ipcRenderer.on("decision-log:updated", handler);
    return () => ipcRenderer.removeListener("decision-log:updated", handler);
  },
});
