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
    discoverLcu() {
      return api.invoke("discover_lcu") as Promise<{
        port: number;
        token: string;
      }>;
    },

    fetchLcu(port: number, token: string, endpoint: string) {
      return api.invoke("fetch_lcu", port, token, endpoint) as Promise<string>;
    },

    fetchRiotApi(endpoint: string) {
      return api.invoke("fetch_riot_api", endpoint) as Promise<string>;
    },

    connectLcuWebSocket(port: number, token: string) {
      return api.invoke("connect_lcu_websocket", port, token) as Promise<void>;
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
