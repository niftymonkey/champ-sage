import { describe, it, expect, beforeEach } from "vitest";
import { createModeRegistry } from "./registry";
import { aramMayhemMode } from "./aram-mayhem";
import { aramMode } from "./aram";
import { classicMode } from "./classic";
import { detectMode, describeModeDetection } from "./detect";
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

  // Patch 16.15.1 added "ARAM: Mayhem Classic-ish" (queues 2450/3280), which
  // reports gameMode KIWI_JADE and is played on map 12 with the legacy 77xxxx
  // item shop and the legacy Jade ability kits. The map fallback exists only
  // to disambiguate Practice Tool, but it applied to every unmatched mode
  // string, so KIWI_JADE silently resolved to plain ARAM and the player got a
  // full game of confident advice about items that were not in their shop.
  it("does not use the mapNumber fallback for an unrecognized queued mode", () => {
    expect(detectMode(registry, "KIWI_JADE", "KIWI_JADE", 12)).toBeNull();
  });
});

describe("describeModeDetection", () => {
  let registry: ModeRegistry;

  beforeEach(() => {
    registry = buildRegistry();
  });

  it("reports no unrecognized mode when detection succeeds", () => {
    const detection = describeModeDetection(registry, "KIWI", "KIWI", 12);
    expect(detection.mode?.id).toBe("aram-mayhem");
    expect(detection.unrecognizedGameMode).toBeNull();
  });

  it("names the unrecognized mode string when nothing matches", () => {
    const detection = describeModeDetection(
      registry,
      "KIWI_JADE",
      "KIWI_JADE",
      12
    );
    expect(detection.mode).toBeNull();
    expect(detection.unrecognizedGameMode).toBe("KIWI_JADE");
  });

  it("falls through to the LCU string when the live value is PRACTICETOOL", () => {
    const detection = describeModeDetection(
      registry,
      "PRACTICETOOL",
      "KIWI_JADE",
      12
    );
    expect(detection.unrecognizedGameMode).toBe("KIWI_JADE");
  });

  it("treats a bare Practice Tool session as recognized-but-unmapped, not drift", () => {
    // PRACTICETOOL with no usable map is an ordinary "we cannot tell which
    // board" case, not an upstream change. Reporting it as drift would train
    // the reader to ignore the signal.
    const detection = describeModeDetection(
      registry,
      "PRACTICETOOL",
      "PRACTICETOOL",
      0
    );
    expect(detection.mode).toBeNull();
    expect(detection.unrecognizedGameMode).toBeNull();
  });

  it("reports nothing while the mode string is still empty", () => {
    const detection = describeModeDetection(registry, "", "", 0);
    expect(detection.mode).toBeNull();
    expect(detection.unrecognizedGameMode).toBeNull();
  });
});
