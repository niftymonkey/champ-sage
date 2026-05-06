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
        const raw = await api.invoke("settings:get", key);
        // main wraps this handler with quietHandler, which resolves
        // errors as `{ __error: string }` instead of rejecting. Treat
        // those as a fallback-to-default signal so the descriptor's
        // parse() doesn't cache the error envelope as the value.
        if (isErrorEnvelope(raw)) return null;
        return raw;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const api = electronApi();
      if (!api) return;
      try {
        await api.invoke("settings:set", key, value);
        // We intentionally don't surface a write failure: the
        // in-memory subject already reflects the user's choice and
        // the store does not retry. Discarding any `{ __error }`
        // envelope keeps that contract.
      } catch {
        // Same reasoning as above — see the comment in the try block.
      }
    },
  };
}

function isErrorEnvelope(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "__error" in value &&
    typeof (value as { __error: unknown }).__error === "string"
  );
}

function electronApi(): ElectronInvoke | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: ElectronInvoke })
    .electronAPI;
  return api ?? null;
}
