import type {
  PlatformBridge,
  LcuEventPayload,
  LcuDisconnectPayload,
} from "./platform-bridge";

/**
 * Type declaration for the API exposed by electron/preload.ts
 * via contextBridge.exposeInMainWorld("electronAPI", ...).
 */
interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  onLcuEvent(callback: (event: unknown) => void): () => void;
  onLcuDisconnect(callback: (event: unknown) => void): () => void;
  onHotkeyEvent(callback: (event: unknown) => void): () => void;
  onGepInfoUpdate(callback: (event: unknown) => void): () => void;
  onGepGameEvent(callback: (event: unknown) => void): () => void;
  onOverlayStatus(callback: (event: unknown) => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function getElectronAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}

/**
 * Unwrap IPC results — the main process returns { __error: msg } instead of
 * throwing to avoid Electron's noisy "Error occurred in handler" logging.
 */
function unwrap<T>(result: unknown): T {
  if (
    result &&
    typeof result === "object" &&
    "__error" in (result as Record<string, unknown>)
  ) {
    throw new Error((result as { __error: string }).__error);
  }
  return result as T;
}

/**
 * Electron implementation of PlatformBridge.
 *
 * Backed by Electron IPC (preload contextBridge). The reactive engine
 * doesn't know or care which implementation it's using.
 */
/**
 * Creates a no-op bridge for environments where Electron is not available
 * (tests, Vite dev server without Electron, etc.). All calls reject/no-op.
 */
function createNoOpBridge(): PlatformBridge {
  const fail = () => Promise.reject(new Error("No runtime bridge available"));
  return {
    discoverLcu: fail,
    fetchLcu: fail,
    fetchRiotApi: fail,
    connectLcuWebSocket: fail,
    listenLcuEvent: async () => () => {},
    listenLcuDisconnect: async () => () => {},
  };
}

export function createElectronBridge(): PlatformBridge {
  const api = getElectronAPI();
  if (!api) {
    return createNoOpBridge();
  }

  return {
    async discoverLcu() {
      return unwrap<{ port: number; token: string }>(
        await api.invoke("discover_lcu")
      );
    },

    async fetchLcu(port: number, token: string, endpoint: string) {
      return unwrap<string>(
        await api.invoke("fetch_lcu", port, token, endpoint)
      );
    },

    async fetchRiotApi(endpoint: string) {
      return unwrap<string>(await api.invoke("fetch_riot_api", endpoint));
    },

    async connectLcuWebSocket(port: number, token: string) {
      return unwrap<void>(
        await api.invoke("connect_lcu_websocket", port, token)
      );
    },

    async listenLcuEvent(handler: (event: LcuEventPayload) => void) {
      return api.onLcuEvent((payload) => {
        handler(payload as LcuEventPayload);
      });
    },

    async listenLcuDisconnect(handler: (event: LcuDisconnectPayload) => void) {
      return api.onLcuDisconnect((payload) => {
        handler(payload as LcuDisconnectPayload);
      });
    },
  };
}

/** Returns true when running inside Electron (preload script has run). */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI;
}
