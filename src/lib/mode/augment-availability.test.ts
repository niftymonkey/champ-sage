import { describe, it, expect } from "vitest";
import { checkAugmentAvailability } from "./augment-availability";
import type { GameMode, ModeContext } from "./types";

const aramMayhem: GameMode = {
  id: "aram-mayhem",
  displayName: "ARAM Mayhem",
  decisionTypes: ["augment-selection"],
  augmentSelectionLevels: [1, 7, 11, 15],
  matches: () => true,
  buildContext: () => ({}) as ModeContext,
};

describe("checkAugmentAvailability", () => {
  it("shows slot 0 available at level 1 with no selections", () => {
    const result = checkAugmentAvailability(1, 0, aramMayhem);
    expect(result.isAvailable).toBe(true);
    expect(result.pendingSlot).toBe(0);
  });

  it("not available at level 1 if already selected first augment", () => {
    const result = checkAugmentAvailability(1, 1, aramMayhem);
    expect(result.isAvailable).toBe(false);
    expect(result.pendingSlot).toBe(-1);
  });

  it("shows slot 1 available at level 7 with 1 selection", () => {
    const result = checkAugmentAvailability(7, 1, aramMayhem);
    expect(result.isAvailable).toBe(true);
    expect(result.pendingSlot).toBe(1);
  });

  it("shows slot 1 available at level 9 with 1 selection (past threshold)", () => {
    const result = checkAugmentAvailability(9, 1, aramMayhem);
    expect(result.isAvailable).toBe(true);
    expect(result.pendingSlot).toBe(1);
  });

  it("not available at level 6 with 1 selection (below threshold)", () => {
    const result = checkAugmentAvailability(6, 1, aramMayhem);
    expect(result.isAvailable).toBe(false);
    expect(result.pendingSlot).toBe(-1);
  });

  it("shows slot 2 available at level 11 with 2 selections", () => {
    const result = checkAugmentAvailability(11, 2, aramMayhem);
    expect(result.isAvailable).toBe(true);
    expect(result.pendingSlot).toBe(2);
  });

  it("shows slot 3 available at level 15 with 3 selections", () => {
    const result = checkAugmentAvailability(15, 3, aramMayhem);
    expect(result.isAvailable).toBe(true);
    expect(result.pendingSlot).toBe(3);
  });

  it("not available when all slots are filled", () => {
    const result = checkAugmentAvailability(18, 4, aramMayhem);
    expect(result.isAvailable).toBe(false);
    expect(result.pendingSlot).toBe(-1);
  });

  it("detects multiple missed selections (level 11 but only 1 selected)", () => {
    const result = checkAugmentAvailability(11, 1, aramMayhem);
    expect(result.isAvailable).toBe(true);
    expect(result.pendingSlot).toBe(1);
  });

  it("returns not available for mode with no augment levels", () => {
    const noAugments: GameMode = {
      ...aramMayhem,
      augmentSelectionLevels: [],
    };
    const result = checkAugmentAvailability(10, 0, noAugments);
    expect(result.isAvailable).toBe(false);
    expect(result.pendingSlot).toBe(-1);
  });
});
