import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SETTINGS, type SettingsIO } from "../settings";

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

/**
 * The personality-store is a thin shim over the `settings` runtime
 * singleton. To isolate each test from the singleton's accumulated
 * state, we reset the module cache before every test — re-importing
 * yields a fresh runtime each time.
 */
describe("personality-store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("defaults to briefPersonality before settings load", async () => {
    const { getPersonality } = await import("./personality-store");
    expect(getPersonality().id).toBe("brief");
  });

  it("reflects the persisted id after settings hydrate", async () => {
    const { loadSettings } = await import("../settings/runtime");
    await loadSettings(inMemoryIO({ "personality.id": "pirate" }), [
      ...ALL_SETTINGS,
    ]);
    const { getPersonality } = await import("./personality-store");
    expect(getPersonality().id).toBe("pirate");
  });

  it("falls back to brief when the persisted id is unknown", async () => {
    const { loadSettings } = await import("../settings/runtime");
    await loadSettings(inMemoryIO({ "personality.id": "nonexistent-id" }), [
      ...ALL_SETTINGS,
    ]);
    const { getPersonality } = await import("./personality-store");
    expect(getPersonality().id).toBe("brief");
  });

  it("setPersonality writes the new id through the IO", async () => {
    const { loadSettings } = await import("../settings/runtime");
    const io = inMemoryIO();
    await loadSettings(io, [...ALL_SETTINGS]);

    const { setPersonality, PERSONALITIES } =
      await import("./personality-store");
    const pirate = PERSONALITIES.find((p) => p.id === "pirate")!;

    setPersonality(pirate);
    await Promise.resolve();
    await Promise.resolve();

    expect(io.store["personality.id"]).toBe("pirate");
  });

  it("personality$ emits the new value on setPersonality", async () => {
    const { loadSettings } = await import("../settings/runtime");
    await loadSettings(inMemoryIO(), [...ALL_SETTINGS]);

    const { personality$, setPersonality, PERSONALITIES } =
      await import("./personality-store");
    const pirate = PERSONALITIES.find((p) => p.id === "pirate")!;
    const observed: string[] = [];
    const sub = personality$.subscribe((p) => observed.push(p.id));

    setPersonality(pirate);
    await Promise.resolve();

    sub.unsubscribe();
    expect(observed).toEqual(["brief", "pirate"]);
  });

  it("setPersonality still updates state when no IO has loaded", async () => {
    const { getPersonality, setPersonality, PERSONALITIES } =
      await import("./personality-store");

    expect(getPersonality().id).toBe("brief");
    const pirate = PERSONALITIES.find((p) => p.id === "pirate")!;
    expect(() => setPersonality(pirate)).not.toThrow();
    expect(getPersonality().id).toBe("pirate");
  });
});
