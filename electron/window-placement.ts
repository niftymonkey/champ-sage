/**
 * Window placement safety. Decides whether persisted window bounds still land
 * on a currently-connected display before we restore them.
 *
 * Restoring saved bounds blindly can drop the window onto a monitor that is no
 * longer attached (laptop undocked, monitor unplugged, resolution change),
 * leaving it off-screen and impossible to grab. We require a minimum visible
 * overlap with some display on both axes so the title bar stays reachable;
 * when no display satisfies that, the caller falls back to a centered default.
 */

import type { WindowBounds } from "./bounds-store";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Minimum overlap, in pixels, the window must share with a display on each
 * axis to count as reachable. Sized to comfortably cover a title bar so the
 * user can always drag the window back into view.
 */
export const MIN_VISIBLE_PX = 64;

export function boundsAreVisible(
  bounds: WindowBounds,
  displays: Rect[]
): boolean {
  return displays.some((display) => {
    // Clamp the required overlap to the window's own size so a window smaller
    // than MIN_VISIBLE_PX is not rejected when it is fully on screen.
    const requiredX = Math.min(bounds.width, MIN_VISIBLE_PX);
    const requiredTopStrip = Math.min(bounds.height, MIN_VISIBLE_PX);
    const overlapX =
      Math.min(bounds.x + bounds.width, display.x + display.width) -
      Math.max(bounds.x, display.x);
    // Measure the window's top strip (the title bar) rather than its full
    // height. A window dragged above the screen can still overlap a display
    // with its lower edge, but if the title bar is off-screen the user cannot
    // grab it to drag it back, so that placement must count as unreachable.
    const topStripOverlapY =
      Math.min(bounds.y + requiredTopStrip, display.y + display.height) -
      Math.max(bounds.y, display.y);
    return overlapX >= requiredX && topStripOverlapY >= requiredTopStrip;
  });
}
