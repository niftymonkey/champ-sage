/**
 * Strip bounds persistence — when the user drags or resizes the strip,
 * we save its absolute bounds to settings JSON so the next launch (and
 * the next `createOverlayWindows` cycle, which fires once per game)
 * reuses them. Without this, every game returns the strip to defaults.
 *
 * The shape is intentionally narrow: just `{ x, y, width, height }`. We
 * do not persist screen resolution; if the user changes monitors the
 * stored bounds may sit off-screen and a future fix can clamp on read.
 */

import type { SettingsIO } from "./strip-resize-lock";

export interface StripBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StripBoundsStore {
  get(): StripBounds | null;
  set(bounds: StripBounds): void;
  clear(): void;
}

const STRIP_BOUNDS_KEY = "stripBounds";

export function createStripBoundsStore(io: SettingsIO): StripBoundsStore {
  return {
    get(): StripBounds | null {
      const raw = io.read()[STRIP_BOUNDS_KEY];
      if (!isStripBounds(raw)) return null;
      return raw;
    },

    set(bounds: StripBounds): void {
      const data = io.read();
      data[STRIP_BOUNDS_KEY] = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      io.write(data);
    },

    clear(): void {
      const data = io.read();
      if (!(STRIP_BOUNDS_KEY in data)) return;
      delete data[STRIP_BOUNDS_KEY];
      io.write(data);
    },
  };
}

function isStripBounds(value: unknown): value is StripBounds {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    v.width > 0 &&
    v.height > 0
  );
}

export { STRIP_BOUNDS_KEY };
