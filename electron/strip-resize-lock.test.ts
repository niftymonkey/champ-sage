import { describe, it, expect, beforeEach } from "vitest";
import {
  createStripResizeLock,
  STRIP_USER_SIZED_KEY,
  type SettingsIO,
} from "./strip-resize-lock";

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

describe("createStripResizeLock", () => {
  let io: ReturnType<typeof inMemoryIO>;

  beforeEach(() => {
    io = inMemoryIO();
  });

  it("returns false when settings file has no entry", () => {
    const lock = createStripResizeLock(io);
    expect(lock.get()).toBe(false);
  });

  it("returns true when settings file already has the lock set", () => {
    io = inMemoryIO({ [STRIP_USER_SIZED_KEY]: true });
    const lock = createStripResizeLock(io);
    expect(lock.get()).toBe(true);
  });

  it("set(true) writes the flag to the settings store", () => {
    const lock = createStripResizeLock(io);
    lock.set(true);
    expect(io.store[STRIP_USER_SIZED_KEY]).toBe(true);
    expect(lock.get()).toBe(true);
  });

  it("set(false) removes the flag from the settings store", () => {
    io = inMemoryIO({ [STRIP_USER_SIZED_KEY]: true });
    const lock = createStripResizeLock(io);
    lock.set(false);
    expect(STRIP_USER_SIZED_KEY in io.store).toBe(false);
    expect(lock.get()).toBe(false);
  });

  it("set(false) is a no-op (no write churn) when key is already absent", () => {
    let writes = 0;
    const trackingIO: SettingsIO = {
      read: () => ({}),
      write: () => {
        writes += 1;
      },
    };
    const lock = createStripResizeLock(trackingIO);
    lock.set(false);
    expect(writes).toBe(0);
  });

  it("a fresh lock instance reads disk state, not in-memory cache", () => {
    const lock1 = createStripResizeLock(io);
    lock1.set(true);

    const lock2 = createStripResizeLock(io);
    expect(lock2.get()).toBe(true);

    lock1.set(false);
    expect(lock2.get()).toBe(false);
  });

  it("preserves unrelated settings keys when toggling the lock", () => {
    io = inMemoryIO({ otherKey: "preserved", another: 42 });
    const lock = createStripResizeLock(io);
    lock.set(true);
    expect(io.store.otherKey).toBe("preserved");
    expect(io.store.another).toBe(42);
    lock.set(false);
    expect(io.store.otherKey).toBe("preserved");
    expect(io.store.another).toBe(42);
  });

  it("coerces non-boolean values in the store to false on read", () => {
    io = inMemoryIO({ [STRIP_USER_SIZED_KEY]: "true" });
    const lock = createStripResizeLock(io);
    expect(lock.get()).toBe(false);
  });
});
