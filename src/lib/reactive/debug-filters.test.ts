import { describe, it, expect } from "vitest";
import {
  isDebugWorthy,
  shouldLogPollStatus,
  describeEvent,
  hasGameStateChangedMeaningfully,
} from "./debug-filters";
import type { LiveGameState } from "./types";
import { createDefaultLiveGameState } from "./streams";

describe("isDebugWorthy", () => {
  it("allows gameflow phase events", () => {
    expect(isDebugWorthy("/lol-gameflow/v1/gameflow-phase")).toBe(true);
  });

  it("allows gameflow session events", () => {
    expect(isDebugWorthy("/lol-gameflow/v1/session")).toBe(true);
  });

  it("allows champ select session events", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/session")).toBe(true);
  });

  it("filters out grid-champions noise", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/grid-champions/143")).toBe(
      false
    );
  });

  it("filters out skin-carousel noise", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/skin-carousel-skins")).toBe(
      false
    );
  });

  it("filters out matchmaking search ticks", () => {
    expect(isDebugWorthy("/lol-matchmaking/v1/search")).toBe(false);
  });

  it("filters out settings updates", () => {
    expect(isDebugWorthy("/lol-settings/v1/account/champ-select")).toBe(false);
  });

  it("filters out hovercard updates", () => {
    expect(isDebugWorthy("/lol-hovercard/v1/friend-info/some-uuid")).toBe(
      false
    );
  });

  it("filters out lobby-team-builder noise", () => {
    expect(
      isDebugWorthy(
        "/lol-lobby-team-builder/champ-select/v1/pickable-champion-ids"
      )
    ).toBe(false);
  });

  it("filters out summoner individual updates", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/summoners/3")).toBe(false);
  });
});

describe("describeEvent", () => {
  it("describes gameflow phase updates", () => {
    expect(
      describeEvent("Update", "/lol-gameflow/v1/gameflow-phase")
    ).toContain("Gameflow phase");
  });

  it("describes game session updates", () => {
    expect(describeEvent("Update", "/lol-gameflow/v1/session")).toContain(
      "Game session"
    );
  });

  it("describes champ select ending", () => {
    expect(describeEvent("Delete", "/lol-champ-select/v1/session")).toBe(
      "Champion Select ended"
    );
  });

  it("describes champ select updates", () => {
    expect(describeEvent("Update", "/lol-champ-select/v1/session")).toBe(
      "Champion Select updated"
    );
  });

  it("describes league session token", () => {
    expect(
      describeEvent("Update", "/lol-league-session/v1/league-session-token")
    ).toContain("League session token");
  });

  it("falls back to raw event for unknown URIs", () => {
    expect(describeEvent("Update", "/unknown/path")).toBe(
      "Update /unknown/path"
    );
  });
});

describe("shouldLogPollStatus", () => {
  it("logs the first status", () => {
    expect(shouldLogPollStatus("LOADING", null)).toBe(true);
  });

  it("suppresses repeated LOADING status", () => {
    expect(shouldLogPollStatus("LOADING", "LOADING")).toBe(false);
  });

  it("logs when status changes from LOADING to OK", () => {
    expect(shouldLogPollStatus("OK", "LOADING")).toBe(true);
  });

  it("logs when status changes from OK to LOADING", () => {
    expect(shouldLogPollStatus("LOADING", "OK")).toBe(true);
  });

  it("suppresses repeated OK status", () => {
    expect(shouldLogPollStatus("OK", "OK")).toBe(false);
  });

  it("logs when status changes from CONNECTION_FAILED to LOADING", () => {
    expect(shouldLogPollStatus("LOADING", "CONNECTION_FAILED")).toBe(true);
  });
});

describe("hasGameStateChangedMeaningfully", () => {
  function makeState(overrides: Partial<LiveGameState> = {}): LiveGameState {
    return { ...createDefaultLiveGameState(), ...overrides };
  }

  it("detects champion change", () => {
    const a = makeState({
      activePlayer: { championName: "Ahri" } as LiveGameState["activePlayer"],
    });
    const b = makeState({
      activePlayer: { championName: "Jinx" } as LiveGameState["activePlayer"],
    });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(true);
  });

  it("detects level change", () => {
    const a = makeState({
      activePlayer: {
        championName: "Ahri",
        level: 5,
      } as LiveGameState["activePlayer"],
    });
    const b = makeState({
      activePlayer: {
        championName: "Ahri",
        level: 6,
      } as LiveGameState["activePlayer"],
    });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(true);
  });

  it("detects player count change", () => {
    const a = makeState({
      players: [{ championName: "Ahri" }] as LiveGameState["players"],
    });
    const b = makeState({ players: [] });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(true);
  });

  it("detects game mode change", () => {
    const a = makeState({ gameMode: "ARAM" });
    const b = makeState({ gameMode: "KIWI" });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(true);
  });

  it("detects champ select appearing", () => {
    const a = makeState({ champSelect: null });
    const b = makeState({ champSelect: { some: "data" } as unknown });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(true);
  });

  it("detects end-of-game stats appearing", () => {
    const a = makeState({ eogStats: null });
    const b = makeState({
      eogStats: {
        gameId: "1",
        gameLength: 600,
        gameMode: "ARAM",
        isWin: true,
        championId: 1,
        items: [],
      },
    });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(true);
  });

  it("ignores game time changes", () => {
    const a = makeState({ gameTime: 100 });
    const b = makeState({ gameTime: 102 });
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(false);
  });

  it("ignores identical states", () => {
    const a = makeState();
    const b = makeState();
    expect(hasGameStateChangedMeaningfully(a, b)).toBe(false);
  });
});
