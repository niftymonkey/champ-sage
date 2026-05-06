import { BehaviorSubject, type Observable } from "rxjs";
import type { AnySetting, SettingValue, SettingsIO } from "./types";

/**
 * Reactive snapshot of every loaded setting's parsed value, keyed by
 * storage key. The store is always a value of `SettingsStore`; tests
 * construct their own via `createSettingsStore()`. Production wires
 * one runtime singleton at app boot (see `runtime.ts`) — module-level
 * state stays out of this file.
 */
export interface SettingsStore {
  /** Reactive snapshot subscribers can observe. */
  readonly settings$: Observable<ReadonlyMap<string, unknown>>;
  /**
   * Hydrate the store from disk. Call once at app start with every
   * setting the renderer wants to read. Missing or unparseable
   * storage values fall back to each descriptor's default.
   */
  loadSettings(
    io: SettingsIO,
    registered: ReadonlyArray<AnySetting>
  ): Promise<void>;
  /** Sync read — returns descriptor's default until `loadSettings` runs. */
  getSetting<S extends AnySetting>(setting: S): SettingValue<S>;
  /**
   * Persist a new value through IO, then emit. The subject reflects
   * the new value before the IO promise's resolution returns to the
   * caller — readers can rely on `getSetting` immediately afterward.
   */
  setSetting<S extends AnySetting>(
    setting: S,
    value: SettingValue<S>
  ): Promise<void>;
}

export function createSettingsStore(): SettingsStore {
  const values = new Map<string, unknown>();
  const subject = new BehaviorSubject<ReadonlyMap<string, unknown>>(
    new Map(values)
  );
  let io: SettingsIO | null = null;

  const emit = (): void => {
    subject.next(new Map(values));
  };

  return {
    settings$: subject.asObservable(),

    async loadSettings(settingsIo, registered) {
      io = settingsIo;
      for (const setting of registered) {
        const raw = await settingsIo.get(setting.storageKey);
        values.set(setting.storageKey, setting.parse(raw));
      }
      emit();
    },

    getSetting<S extends AnySetting>(setting: S): SettingValue<S> {
      if (!values.has(setting.storageKey))
        return setting.defaultValue as SettingValue<S>;
      return values.get(setting.storageKey) as SettingValue<S>;
    },

    async setSetting<S extends AnySetting>(
      setting: S,
      value: SettingValue<S>
    ): Promise<void> {
      values.set(setting.storageKey, value);
      emit();
      if (io) {
        await io.set(setting.storageKey, value);
      }
    },
  };
}
