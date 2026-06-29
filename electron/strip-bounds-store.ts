/**
 * Strip bounds persistence. When the user drags or resizes the strip, we save
 * its absolute bounds to settings JSON so the next launch (and the next
 * `createOverlayWindows` cycle, which fires once per game) reuses them. Without
 * this, every game returns the strip to defaults.
 *
 * This is a thin binding over the generic `createBoundsStore`; the strip simply
 * owns the `stripBounds` key. See `bounds-store.ts` for the shared machinery.
 */

import type { SettingsIO } from "./strip-resize-lock";
import { createBoundsStore } from "./bounds-store";
import type { WindowBounds, BoundsStore } from "./bounds-store";

export type StripBounds = WindowBounds;
export type StripBoundsStore = BoundsStore;

const STRIP_BOUNDS_KEY = "stripBounds";

export function createStripBoundsStore(io: SettingsIO): StripBoundsStore {
  return createBoundsStore(io, STRIP_BOUNDS_KEY);
}

export { STRIP_BOUNDS_KEY };
