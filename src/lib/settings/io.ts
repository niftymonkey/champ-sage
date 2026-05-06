import type { SettingsIO } from "./types";

interface ElectronInvoke {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Renderer-side `SettingsIO` that round-trips through the existing
 * `settings:get` / `settings:set` IPC handlers in the main process.
 * Returns `null` when the bridge is unavailable (test envs without
 * the preload script) so the store falls back to defaults cleanly.
 */
export function createElectronSettingsIO(): SettingsIO {
  return {
    async get(key) {
      const api = electronApi();
      if (!api) return null;
      try {
        return await api.invoke("settings:get", key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const api = electronApi();
      if (!api) return;
      try {
        await api.invoke("settings:set", key, value);
      } catch {
        // Fail silently — the in-memory subject already reflects the
        // user's choice; they'll get the prior persisted value back
        // on next launch. The store does not retry.
      }
    },
  };
}

function electronApi(): ElectronInvoke | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: ElectronInvoke })
    .electronAPI;
  return api ?? null;
}
