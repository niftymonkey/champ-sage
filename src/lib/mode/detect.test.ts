import { describe, it, expect, beforeEach } from "vitest";
import { createModeRegistry } from "./registry";
import { aramMayhemMode } from "./aram-mayhem";
import { aramMode } from "./aram";
import { classicMode } from "./classic";
import { detectMode } from "./detect";
import type { ModeRegistry } from "./types";

function buildRegistry(): ModeRegistry {
  const r = createModeRegistry();
  r.register(aramMayhemMode);
  r.register(aramMode);
  r.register(classicMode);
  return r;
}

describe("detectMode", () => {
  let registry: ModeRegistry;

  beforeEach(() => {
    registry = buildRegistry();
  });

  it("matches the live-client mode when it is recognized", () => {
    expect(detectMode(registry, "CLASSIC", "")?.id).toBe("classic");
    expect(detectMode(registry, "ARAM", "")?.id).toBe("aram");
    expect(detectMode(registry, "KIWI", "")?.id).toBe("aram-mayhem");
  });

  it("falls back to the LCU mode when live-client returns PRACTICETOOL", () => {
    // Practice Tool on Summoner's Rift: live=PRACTICETOOL, LCU=CLASSIC.
    // Without the fallback, mode detection would fail and the coaching
    // pipeline would never start. This is the primary regression case.
    expect(detectMode(registry, "PRACTICETOOL", "CLASSIC")?.id).toBe("classic");
    expect(detectMode(registry, "PRACTICETOOL", "ARAM")?.id).toBe("aram");
    expect(detectMode(registry, "PRACTICETOOL", "KIWI")?.id).toBe(
      "aram-mayhem"
    );
  });

  it("falls back to LCU mode for any unknown live-client value, not only PRACTICETOOL", () => {
    // Future-proofing: any new mode string Riot adds that we have not yet
    // mapped should still light up if the LCU value is one we know about.
    expect(detectMode(registry, "TUTORIAL_MODULE_3", "CLASSIC")?.id).toBe(
      "classic"
    );
  });

  it("prefers the live-client mode over the LCU mode when both match", () => {
    // The Live Client Data API is the source of truth during play.
    // The LCU mode is just a tiebreaker for ambiguous live values.
    expect(detectMode(registry, "CLASSIC", "ARAM")?.id).toBe("classic");
  });

  it("returns null when neither input matches any registered mode", () => {
    expect(detectMode(registry, "PRACTICETOOL", "")).toBeNull();
    expect(detectMode(registry, "", "")).toBeNull();
    expect(detectMode(registry, "UNKNOWN_MODE", "ALSO_UNKNOWN")).toBeNull();
  });

  it("falls back to mapNumber when both gameMode and lcuGameMode are PRACTICETOOL", () => {
    // Practice Tool sessions report PRACTICETOOL from BOTH the Live Client
    // and the LCU - the gameflow queue field echoes "PRACTICETOOL" too. The
    // map number from the Live Client gameData block is the only signal that
    // tells us which board the player chose: 11 = SR, 12 = ARAM, 30 = Arena.
    expect(detectMode(registry, "PRACTICETOOL", "PRACTICETOOL", 11)?.id).toBe(
      "classic"
    );
    expect(detectMode(registry, "PRACTICETOOL", "PRACTICETOOL", 12)?.id).toBe(
      "aram"
    );
  });

  it("ignores mapNumber when gameMode or lcuGameMode already matched", () => {
    // mapNumber is a tiebreaker, never a primary signal. If the engine
    // gives us a mismatched map id we should still trust the mode strings.
    expect(detectMode(registry, "ARAM", "ARAM", 11)?.id).toBe("aram");
  });

  it("returns null when mapNumber is 0 or unknown and other inputs do not match", () => {
    expect(detectMode(registry, "PRACTICETOOL", "PRACTICETOOL", 0)).toBeNull();
    expect(
      detectMode(registry, "PRACTICETOOL", "PRACTICETOOL", 999)
    ).toBeNull();
  });
});
