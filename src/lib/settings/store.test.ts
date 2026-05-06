import { describe, it, expect } from "vitest";
import { firstValueFrom } from "rxjs";
import { createSettingsStore } from "./store";
import { defineBoolean, defineEnum } from "./define";
import type { SettingsIO } from "./types";

function inMemoryIO(initial: Record<string, unknown> = {}): SettingsIO & {
  store: Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    async get(key) {
      return key in store ? store[key] : null;
    },
    async set(key, value) {
      store[key] = value;
    },
  };
}

const flag = defineBoolean({
  key: "flag",
  storageKey: "test.flag",
  label: "Flag",
  description: "A flag.",
  defaultValue: false,
});

const voice = defineEnum<"brief" | "pirate">({
  key: "voice",
  storageKey: "test.voice",
  label: "Voice",
  description: "Coach voice.",
  defaultValue: "brief",
  options: [
    { value: "brief", label: "Brief" },
    { value: "pirate", label: "Pirate" },
  ],
});

describe("createSettingsStore", () => {
  describe("loadSettings", () => {
    it("hydrates each registered setting from the IO", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO({ "test.flag": true, "test.voice": "pirate" });
      await store.loadSettings(io, [flag, voice]);
      expect(store.getSetting(flag)).toBe(true);
      expect(store.getSetting(voice)).toBe("pirate");
    });

    it("falls back to default when storage value is missing", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO({});
      await store.loadSettings(io, [flag, voice]);
      expect(store.getSetting(flag)).toBe(false);
      expect(store.getSetting(voice)).toBe("brief");
    });

    it("falls back to default when storage value fails to parse", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO({
        "test.flag": "not-a-bool",
        "test.voice": "screaming",
      });
      await store.loadSettings(io, [flag, voice]);
      expect(store.getSetting(flag)).toBe(false);
      expect(store.getSetting(voice)).toBe("brief");
    });

    it("emits the hydrated map on settings$", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO({ "test.flag": true });
      await store.loadSettings(io, [flag, voice]);
      const map = await firstValueFrom(store.settings$);
      expect(map.get("test.flag")).toBe(true);
      expect(map.get("test.voice")).toBe("brief");
    });
  });

  describe("setSetting", () => {
    it("writes through to IO using the storage key", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO();
      await store.loadSettings(io, [flag]);
      await store.setSetting(flag, true);
      expect(io.store["test.flag"]).toBe(true);
    });

    it("updates getSetting immediately", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO();
      await store.loadSettings(io, [flag]);
      await store.setSetting(flag, true);
      expect(store.getSetting(flag)).toBe(true);
    });

    it("emits a fresh snapshot on settings$", async () => {
      const store = createSettingsStore();
      const io = inMemoryIO();
      await store.loadSettings(io, [flag]);
      await store.setSetting(flag, true);
      const map = await firstValueFrom(store.settings$);
      expect(map.get("test.flag")).toBe(true);
    });
  });

  describe("getSetting before load", () => {
    it("returns the descriptor's default", () => {
      const store = createSettingsStore();
      expect(store.getSetting(flag)).toBe(false);
      expect(store.getSetting(voice)).toBe("brief");
    });
  });

  it("two stores are independent (no shared module state)", async () => {
    const a = createSettingsStore();
    const b = createSettingsStore();
    const io = inMemoryIO();
    await a.loadSettings(io, [flag]);
    await a.setSetting(flag, true);
    expect(a.getSetting(flag)).toBe(true);
    expect(b.getSetting(flag)).toBe(false);
  });
});
