/**
 * Generic user-preference module. Each setting is a typed descriptor that
 * carries everything the persistence layer (`store.ts`) and the Settings
 * UI need: storage key, default, label, description, value parser. The
 * descriptor is the typed key — pass it to `getSetting` / `setSetting`
 * and TypeScript flows the value type through.
 *
 * Adding a new setting type (e.g. a date range) means writing one new
 * `define...` builder. Existing settings, the store, and the hook stay
 * unchanged.
 */

interface SettingBase<T> {
  /** Stable identifier for typed lookups in code. */
  key: string;
  /** Storage key inside settings.json. Prefixed for readability. */
  storageKey: string;
  /** Short label rendered in the Settings UI row. */
  label: string;
  /** One-sentence explanation rendered alongside the control. */
  description: string;
  /** Used when the storage entry is missing or unparseable. */
  defaultValue: T;
  /** Coerce / validate a raw stored value. Returns default on mismatch. */
  parse(raw: unknown): T;
}

export interface BooleanSetting extends SettingBase<boolean> {
  type: "boolean";
}

export interface StringSetting extends SettingBase<string> {
  type: "string";
  /** Optional max length to defend against accidental garbage. */
  maxLength?: number;
}

export interface NumberSetting extends SettingBase<number> {
  type: "number";
  /** Inclusive lower bound; values below are clamped to default. */
  min?: number;
  /** Inclusive upper bound; values above are clamped to default. */
  max?: number;
}

export interface EnumSetting<T extends string> extends SettingBase<T> {
  type: "enum";
  /** UI-orderable list of allowed values + their labels. */
  options: ReadonlyArray<{ value: T; label: string }>;
}

/** Discriminated union covering every shipped setting type. */
export type AnySetting =
  | BooleanSetting
  | StringSetting
  | NumberSetting
  | EnumSetting<string>;

/**
 * Maps a concrete setting descriptor back to its value type so the
 * store/hook generics can stay discriminated. Avoids the intersection
 * hack (`SettingBase<T> & { type: AnySetting["type"] }`) that would
 * widen `type` and let `BooleanSetting` masquerade as `NumberSetting`.
 */
export type SettingValue<S extends AnySetting> =
  S extends SettingBase<infer T> ? T : never;

/**
 * Persistence transport. The renderer wires this to
 * `electronAPI.invoke("settings:get" | "settings:set")`; tests pass an
 * in-memory implementation. Keeping the seam narrow keeps the store
 * decoupled from Electron entirely.
 */
export interface SettingsIO {
  get(storageKey: string): Promise<unknown>;
  set(storageKey: string, value: unknown): Promise<void>;
}

/**
 * Group descriptor for the Settings UI to iterate. Pure presentation —
 * the store doesn't read this; it only knows individual settings.
 *
 * The `id` is a stable anchor used by the left-rail nav to scroll the
 * canvas to a section. The `caption` is a short mono-uppercase tagline
 * shown under the rail entry (e.g. "DATA + MIC"). When `settings` is
 * empty, the canvas section can still render via a custom component
 * passed at the surface level — useful for sections like "Overlays"
 * that mix typed settings with one-off action buttons, or "About"
 * which renders information rather than controls.
 */
export interface SettingGroup {
  id: string;
  title: string;
  caption?: string;
  description?: string;
  settings: ReadonlyArray<AnySetting>;
}
