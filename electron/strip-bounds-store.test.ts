import { describe, it, expect, beforeEach } from "vitest";
import { createStripBoundsStore, STRIP_BOUNDS_KEY } from "./strip-bounds-store";
import type { SettingsIO } from "./strip-resize-lock";

function inMemoryIO(initial: Record<string, unknown> = {}): SettingsIO & {
  store: Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    read: () => ({ ...store }),
    write: (data) => {
      for (const k of Object.keys(store)) delete store[k];
      Object.assign(store, data);
    },
  };
}

describe("createStripBoundsStore", () => {
  let io: ReturnType<typeof inMemoryIO>;

  beforeEach(() => {
    io = inMemoryIO();
  });

  it("get returns null when settings file has no entry", () => {
    const store = createStripBoundsStore(io);
    expect(store.get()).toBeNull();
  });

  it("set writes the bounds to the settings store", () => {
    const store = createStripBoundsStore(io);
    store.set({ x: 100, y: 200, width: 500, height: 300 });
    expect(io.store[STRIP_BOUNDS_KEY]).toEqual({
      x: 100,
      y: 200,
      width: 500,
      height: 300,
    });
    expect(store.get()).toEqual({ x: 100, y: 200, width: 500, height: 300 });
  });

  it("set rounds non-integer coordinates", () => {
    const store = createStripBoundsStore(io);
    store.set({ x: 100.7, y: 200.3, width: 500.5, height: 300.4 });
    expect(store.get()).toEqual({ x: 101, y: 200, width: 501, height: 300 });
  });

  it("clear removes the entry", () => {
    io = inMemoryIO({
      [STRIP_BOUNDS_KEY]: { x: 1, y: 2, width: 3, height: 4 },
    });
    const store = createStripBoundsStore(io);
    store.clear();
    expect(STRIP_BOUNDS_KEY in io.store).toBe(false);
    expect(store.get()).toBeNull();
  });

  it("clear is a no-op when key is already absent", () => {
    let writes = 0;
    const trackingIO: SettingsIO = {
      read: () => ({}),
      write: () => {
        writes += 1;
      },
    };
    const store = createStripBoundsStore(trackingIO);
    store.clear();
    expect(writes).toBe(0);
  });

  it("get rejects malformed bounds (missing field) and returns null", () => {
    io = inMemoryIO({
      [STRIP_BOUNDS_KEY]: { x: 1, y: 2, width: 3 },
    });
    const store = createStripBoundsStore(io);
    expect(store.get()).toBeNull();
  });

  it("get rejects bounds with non-positive width or height", () => {
    io = inMemoryIO({
      [STRIP_BOUNDS_KEY]: { x: 1, y: 2, width: 0, height: 100 },
    });
    expect(createStripBoundsStore(io).get()).toBeNull();

    io = inMemoryIO({
      [STRIP_BOUNDS_KEY]: { x: 1, y: 2, width: 100, height: -5 },
    });
    expect(createStripBoundsStore(io).get()).toBeNull();
  });

  it("preserves unrelated settings keys when toggling bounds", () => {
    io = inMemoryIO({ otherKey: "preserved" });
    const store = createStripBoundsStore(io);
    store.set({ x: 1, y: 2, width: 3, height: 4 });
    expect(io.store.otherKey).toBe("preserved");
    store.clear();
    expect(io.store.otherKey).toBe("preserved");
  });

  it("a fresh store instance reads disk state, not in-memory cache", () => {
    const a = createStripBoundsStore(io);
    a.set({ x: 1, y: 2, width: 3, height: 4 });
    const b = createStripBoundsStore(io);
    expect(b.get()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
