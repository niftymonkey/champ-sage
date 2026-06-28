import { describe, it, expect, beforeEach } from "vitest";
import { createBoundsStore } from "./bounds-store";
import type { SettingsIO } from "./strip-resize-lock";

const KEY = "mainWindowBounds";

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

describe("createBoundsStore", () => {
  let io: ReturnType<typeof inMemoryIO>;

  beforeEach(() => {
    io = inMemoryIO();
  });

  it("get returns null when settings file has no entry", () => {
    const store = createBoundsStore(io, KEY);
    expect(store.get()).toBeNull();
  });

  it("set writes the bounds under the provided key", () => {
    const store = createBoundsStore(io, KEY);
    store.set({ x: 100, y: 200, width: 500, height: 300 });
    expect(io.store[KEY]).toEqual({ x: 100, y: 200, width: 500, height: 300 });
    expect(store.get()).toEqual({ x: 100, y: 200, width: 500, height: 300 });
  });

  it("set rounds non-integer coordinates", () => {
    const store = createBoundsStore(io, KEY);
    store.set({ x: 100.7, y: 200.3, width: 500.5, height: 300.4 });
    expect(store.get()).toEqual({ x: 101, y: 200, width: 501, height: 300 });
  });

  it("clear removes the entry", () => {
    io = inMemoryIO({ [KEY]: { x: 1, y: 2, width: 3, height: 4 } });
    const store = createBoundsStore(io, KEY);
    store.clear();
    expect(KEY in io.store).toBe(false);
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
    const store = createBoundsStore(trackingIO, KEY);
    store.clear();
    expect(writes).toBe(0);
  });

  it("get rejects malformed bounds (missing field) and returns null", () => {
    io = inMemoryIO({ [KEY]: { x: 1, y: 2, width: 3 } });
    expect(createBoundsStore(io, KEY).get()).toBeNull();
  });

  it("get rejects bounds with non-positive width or height", () => {
    io = inMemoryIO({ [KEY]: { x: 1, y: 2, width: 0, height: 100 } });
    expect(createBoundsStore(io, KEY).get()).toBeNull();

    io = inMemoryIO({ [KEY]: { x: 1, y: 2, width: 100, height: -5 } });
    expect(createBoundsStore(io, KEY).get()).toBeNull();
  });

  it("get rejects non-finite coordinates", () => {
    io = inMemoryIO({ [KEY]: { x: NaN, y: 2, width: 100, height: 100 } });
    expect(createBoundsStore(io, KEY).get()).toBeNull();
  });

  it("get rejects infinite width or height", () => {
    // Infinity passes a bare `> 0` check, so the validator must test finiteness
    // for the dimensions too, not just the coordinates.
    io = inMemoryIO({ [KEY]: { x: 1, y: 2, width: Infinity, height: 100 } });
    expect(createBoundsStore(io, KEY).get()).toBeNull();

    io = inMemoryIO({ [KEY]: { x: 1, y: 2, width: 100, height: Infinity } });
    expect(createBoundsStore(io, KEY).get()).toBeNull();
  });

  it("two stores with different keys do not collide", () => {
    const a = createBoundsStore(io, "mainWindowBounds");
    const b = createBoundsStore(io, "stripBounds");
    a.set({ x: 1, y: 1, width: 10, height: 10 });
    b.set({ x: 2, y: 2, width: 20, height: 20 });
    expect(a.get()).toEqual({ x: 1, y: 1, width: 10, height: 10 });
    expect(b.get()).toEqual({ x: 2, y: 2, width: 20, height: 20 });
  });

  it("preserves unrelated settings keys when toggling bounds", () => {
    io = inMemoryIO({ otherKey: "preserved" });
    const store = createBoundsStore(io, KEY);
    store.set({ x: 1, y: 2, width: 3, height: 4 });
    expect(io.store.otherKey).toBe("preserved");
    store.clear();
    expect(io.store.otherKey).toBe("preserved");
  });

  it("a fresh store instance reads disk state, not in-memory cache", () => {
    const a = createBoundsStore(io, KEY);
    a.set({ x: 1, y: 2, width: 3, height: 4 });
    const b = createBoundsStore(io, KEY);
    expect(b.get()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
