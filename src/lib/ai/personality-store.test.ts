import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Electron IPC bridge by stubbing window.electronAPI before each
// test. The store reads via `window.electronAPI.invoke("settings:get", ...)`
// and writes via `invoke("settings:set", ...)`. We re-import the module per
// test to pick up the fresh stub state — the BehaviorSubject is module-level.

interface InvokeFn {
  (channel: string, ...args: unknown[]): Promise<unknown>;
}

function installBridge(invoke: InvokeFn): void {
  (window as unknown as { electronAPI: { invoke: InvokeFn } }).electronAPI = {
    invoke,
  };
}

function clearBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}

describe("personality-store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    clearBridge();
  });

  it("defaults to briefPersonality before hydration completes", async () => {
    installBridge(() => new Promise(() => {})); // never resolves
    const { getPersonality } = await import("./personality-store");
    expect(getPersonality().id).toBe("brief");
  });

  it("hydrates from the persisted id when the bridge returns one", async () => {
    installBridge(async (channel, key) => {
      if (channel === "settings:get" && key === "personality.id")
        return "pirate";
      return null;
    });
    const { personality$ } = await import("./personality-store");
    // Wait for the microtask that resolves the IPC promise.
    await Promise.resolve();
    await Promise.resolve();
    expect(personality$.getValue().id).toBe("pirate");
  });

  it("falls back to brief when the persisted id is unknown", async () => {
    installBridge(async (channel) => {
      if (channel === "settings:get") return "nonexistent-id";
      return null;
    });
    const { personality$ } = await import("./personality-store");
    await Promise.resolve();
    await Promise.resolve();
    expect(personality$.getValue().id).toBe("brief");
  });

  it("setPersonality writes the new id through the bridge", async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    installBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      return null;
    });
    const { setPersonality, PERSONALITIES } =
      await import("./personality-store");
    const pirate = PERSONALITIES.find((p) => p.id === "pirate")!;

    setPersonality(pirate);

    const setCall = calls.find((c) => c.channel === "settings:set");
    expect(setCall).toBeDefined();
    expect(setCall!.args).toEqual(["personality.id", "pirate"]);
  });

  it("personality$ emits the new value on setPersonality", async () => {
    installBridge(async () => null);
    const { personality$, setPersonality, PERSONALITIES } =
      await import("./personality-store");
    const pirate = PERSONALITIES.find((p) => p.id === "pirate")!;
    const observed: string[] = [];
    const sub = personality$.subscribe((p) => observed.push(p.id));

    setPersonality(pirate);

    sub.unsubscribe();
    expect(observed).toEqual(["brief", "pirate"]);
  });

  it("works without an Electron bridge present (test / web context)", async () => {
    clearBridge();
    const { getPersonality, setPersonality, PERSONALITIES } =
      await import("./personality-store");

    expect(getPersonality().id).toBe("brief");

    const pirate = PERSONALITIES.find((p) => p.id === "pirate")!;
    expect(() => setPersonality(pirate)).not.toThrow();
    expect(getPersonality().id).toBe("pirate");
  });
});
