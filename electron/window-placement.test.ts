import { describe, it, expect } from "vitest";
import {
  boundsAreVisible,
  MIN_VISIBLE_PX,
  type Rect,
} from "./window-placement";

// A typical dual-monitor layout: primary at the origin, a secondary monitor
// to the right. Work areas omit the taskbar but that detail is irrelevant
// to the geometry under test.
const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const SECONDARY: Rect = { x: 1920, y: 0, width: 2560, height: 1440 };

describe("boundsAreVisible", () => {
  it("returns true for a window fully inside a single display", () => {
    expect(
      boundsAreVisible({ x: 100, y: 100, width: 1200, height: 900 }, [PRIMARY])
    ).toBe(true);
  });

  it("returns true for a window docked on the secondary display", () => {
    // Right half of the 2560-wide secondary monitor.
    expect(
      boundsAreVisible({ x: 1920 + 1280, y: 0, width: 1280, height: 1440 }, [
        PRIMARY,
        SECONDARY,
      ])
    ).toBe(true);
  });

  it("returns false when the secondary display is gone and bounds are stranded", () => {
    // Saved on the now-absent secondary monitor; only primary remains.
    expect(
      boundsAreVisible({ x: 1920 + 1280, y: 0, width: 1280, height: 1440 }, [
        PRIMARY,
      ])
    ).toBe(false);
  });

  it("returns false for bounds entirely off every display", () => {
    expect(
      boundsAreVisible({ x: 10000, y: 10000, width: 800, height: 600 }, [
        PRIMARY,
        SECONDARY,
      ])
    ).toBe(false);
  });

  it("returns false when overlap is below the reachable threshold on the x axis", () => {
    // Only MIN_VISIBLE_PX - 1 pixels of the window's left edge sit on screen.
    const sliver = MIN_VISIBLE_PX - 1;
    expect(
      boundsAreVisible(
        { x: PRIMARY.width - sliver, y: 100, width: 800, height: 600 },
        [PRIMARY]
      )
    ).toBe(false);
  });

  it("returns true when overlap exactly meets the reachable threshold", () => {
    expect(
      boundsAreVisible(
        { x: PRIMARY.width - MIN_VISIBLE_PX, y: 100, width: 800, height: 600 },
        [PRIMARY]
      )
    ).toBe(true);
  });

  it("returns true for a fully visible window smaller than the reachable threshold", () => {
    // A 40x40 window sitting entirely on screen is reachable even though it is
    // smaller than MIN_VISIBLE_PX; the required overlap clamps to its own size.
    expect(
      boundsAreVisible({ x: 100, y: 100, width: 40, height: 40 }, [PRIMARY])
    ).toBe(true);
  });

  it("returns false when overlap is below the reachable threshold on the y axis", () => {
    const sliver = MIN_VISIBLE_PX - 1;
    expect(
      boundsAreVisible(
        { x: 100, y: PRIMARY.height - sliver, width: 800, height: 600 },
        [PRIMARY]
      )
    ).toBe(false);
  });

  it("returns false when the title bar is above the display even if the bottom strip overlaps", () => {
    // Window dragged up off the top: its lower edge dips ~70px into the
    // display, so a naive total-overlap check would call it visible, but the
    // title bar sits above y=0 where the user cannot grab it.
    expect(
      boundsAreVisible({ x: 100, y: -550, width: 800, height: 620 }, [PRIMARY])
    ).toBe(false);
  });

  it("returns false when there are no displays at all", () => {
    expect(boundsAreVisible({ x: 0, y: 0, width: 800, height: 600 }, [])).toBe(
      false
    );
  });
});
