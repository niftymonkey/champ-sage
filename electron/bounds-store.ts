/**
 * Generic window-bounds persistence. Saves `{ x, y, width, height }` under a
 * caller-chosen key in the shared settings JSON so a window's position and
 * size survive both process restarts and any per-game window re-creation.
 *
 * The strip overlay and the main desktop window each own a distinct key; this
 * factory is the shared machinery. Validation is intentionally strict: a
 * malformed or non-positive-size record reads back as `null` so the caller
 * falls back to its own defaults rather than restoring a broken window.
 */

import type { SettingsIO } from "./strip-resize-lock";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundsStore {
  get(): WindowBounds | null;
  set(bounds: WindowBounds): void;
  clear(): void;
}

export function createBoundsStore(io: SettingsIO, key: string): BoundsStore {
  return {
    get(): WindowBounds | null {
      const raw = io.read()[key];
      if (!isWindowBounds(raw)) return null;
      return raw;
    },

    set(bounds: WindowBounds): void {
      const data = io.read();
      data[key] = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      io.write(data);
    },

    clear(): void {
      const data = io.read();
      if (!(key in data)) return;
      delete data[key];
      io.write(data);
    },
  };
}

export function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.width) &&
    Number.isFinite(v.height) &&
    v.width > 0 &&
    v.height > 0
  );
}
