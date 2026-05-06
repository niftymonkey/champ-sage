import { createSettingsStore, type SettingsStore } from "./store";

/**
 * Process-wide singleton store for the renderer. Bound once and shared
 * by every consumer (settings UI rows, sync readers like the post-game
 * takeaway gate). Tests do not use this — they construct fresh stores
 * via `createSettingsStore()`.
 */
const runtime: SettingsStore = createSettingsStore();

export const settings$ = runtime.settings$;
export const loadSettings = runtime.loadSettings.bind(runtime);
export const getSetting = runtime.getSetting.bind(runtime);
export const setSetting = runtime.setSetting.bind(runtime);
