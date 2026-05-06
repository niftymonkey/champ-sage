import { describe, it, expect } from "vitest";
import { resolveSurface } from "./resolveSurface";

describe("resolveSurface", () => {
  describe("manual override", () => {
    it("respects an explicit override regardless of phase", () => {
      // The user clicked SETTINGS in the nav while a game is loading -
      // they should land on settings, not be hijacked by the phase machinery.
      expect(
        resolveSurface({
          phase: "InProgress",
          hasActivePlayer: true,
          manualOverride: "settings",
          hasSeenInGamePhase: true,
        })
      ).toBe("settings");
    });
  });

  describe("phase-driven default (no override)", () => {
    it("returns idle when phase is null (LCU not yet connected)", () => {
      expect(
        resolveSurface({
          phase: null,
          hasActivePlayer: false,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("idle");
    });

    it("returns idle for None / Lobby / Matchmaking / ReadyCheck", () => {
      for (const phase of [
        "None",
        "Lobby",
        "Matchmaking",
        "ReadyCheck",
      ] as const) {
        expect(
          resolveSurface({
            phase,
            hasActivePlayer: false,
            manualOverride: null,
            hasSeenInGamePhase: true,
          })
        ).toBe("idle");
      }
    });

    it("returns champ-select during ChampSelect", () => {
      expect(
        resolveSurface({
          phase: "ChampSelect",
          hasActivePlayer: false,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("champ-select");
    });

    it("returns in-game during GameStart and InProgress", () => {
      // Live Client polling has not produced a player yet at GameStart;
      // we still want the in-game view rendered (with its empty placeholders)
      // so the player sees the right surface as soon as the game window opens.
      expect(
        resolveSurface({
          phase: "GameStart",
          hasActivePlayer: false,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("in-game");
      expect(
        resolveSurface({
          phase: "InProgress",
          hasActivePlayer: true,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("in-game");
    });

    it("returns post-game during PreEndOfGame / EndOfGame / WaitingForStats", () => {
      for (const phase of [
        "PreEndOfGame",
        "EndOfGame",
        "WaitingForStats",
      ] as const) {
        expect(
          resolveSurface({
            phase,
            hasActivePlayer: true,
            manualOverride: null,
            hasSeenInGamePhase: true,
          })
        ).toBe("post-game");
      }
    });

    it("returns idle on TerminatedInError - the game is gone, nothing in-game to show", () => {
      expect(
        resolveSurface({
          phase: "TerminatedInError",
          hasActivePlayer: false,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("idle");
    });
  });

  describe("fresh-launch behaviour", () => {
    it("falls back to idle on EndOfGame when we have not yet seen an in-game phase", () => {
      // Fresh app launch finds the LCU still reporting EndOfGame from the
      // previous match. The user expects Home, not History.
      expect(
        resolveSurface({
          phase: "EndOfGame",
          hasActivePlayer: false,
          manualOverride: null,
          hasSeenInGamePhase: false,
        })
      ).toBe("idle");
    });

    it("routes to post-game once an in-game phase has been seen this session", () => {
      // Same EndOfGame phase, but we observed an InProgress earlier — the
      // user did finish a match this session, so the post-game view applies.
      expect(
        resolveSurface({
          phase: "EndOfGame",
          hasActivePlayer: false,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("post-game");
    });
  });

  describe("simulator escape hatch", () => {
    it("returns in-game when a player is present even with no phase signal", () => {
      // The dev simulator injects an activePlayer without LCU phase events.
      // Without this clause the simulator would always render idle.
      expect(
        resolveSurface({
          phase: null,
          hasActivePlayer: true,
          manualOverride: null,
          hasSeenInGamePhase: true,
        })
      ).toBe("in-game");
    });
  });
});
