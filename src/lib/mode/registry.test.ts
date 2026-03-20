import { describe, it, expect } from "vitest";
import { createModeRegistry } from "./registry";
import type { GameMode, ModeContext } from "./types";

function createStubMode(
  id: string,
  matchFn: (gameMode: string) => boolean
): GameMode {
  return {
    id,
    displayName: id,
    decisionTypes: [],
    augmentSelectionLevels: [],
    matches: matchFn,
    buildContext: () => ({}) as ModeContext,
  };
}

describe("createModeRegistry", () => {
  it("returns null when no modes are registered", () => {
    const registry = createModeRegistry();
    expect(registry.detect("ARAM")).toBeNull();
  });

  it("detects a registered mode by gameMode string", () => {
    const registry = createModeRegistry();
    const aramMayhem = createStubMode("aram-mayhem", (gm) => gm === "ARAM");
    registry.register(aramMayhem);

    expect(registry.detect("ARAM")).toBe(aramMayhem);
  });

  it("returns null for unmatched gameMode strings", () => {
    const registry = createModeRegistry();
    registry.register(createStubMode("aram-mayhem", (gm) => gm === "ARAM"));

    expect(registry.detect("CLASSIC")).toBeNull();
  });

  it("returns the first matching mode when multiple are registered", () => {
    const registry = createModeRegistry();
    const first = createStubMode("first", (gm) => gm === "ARAM");
    const second = createStubMode("second", (gm) => gm === "ARAM");
    registry.register(first);
    registry.register(second);

    expect(registry.detect("ARAM")).toBe(first);
  });

  it("matches different modes for different gameMode strings", () => {
    const registry = createModeRegistry();
    const aram = createStubMode("aram-mayhem", (gm) => gm === "ARAM");
    const arena = createStubMode("arena", (gm) => gm === "CHERRY");
    registry.register(aram);
    registry.register(arena);

    expect(registry.detect("ARAM")).toBe(aram);
    expect(registry.detect("CHERRY")).toBe(arena);
    expect(registry.detect("CLASSIC")).toBeNull();
  });
});
