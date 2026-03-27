import { describe, it, expect } from "vitest";
import {
  summarizeLifecycleEvent,
  summarizeLiveGameState,
  summarizeUserInput,
} from "./debug-summarizers";
import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
} from "./types";
import type { ActivePlayer } from "../game-state/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultLiveGameState(
  overrides: Partial<LiveGameState> = {}
): LiveGameState {
  return {
    activePlayer: null,
    players: [],
    gameMode: "",
    lcuGameMode: "",
    gameTime: 0,
    champSelect: null,
    eogStats: null,
    ...overrides,
  };
}

function createActivePlayer(
  overrides: Partial<ActivePlayer> = {}
): ActivePlayer {
  return {
    championName: "Ahri",
    level: 6,
    currentGold: 1500,
    runes: {
      keystone: "Dark Harvest",
      primaryTree: "Domination",
      secondaryTree: "Sorcery",
    },
    stats: {
      abilityPower: 0,
      armor: 30,
      attackDamage: 50,
      attackSpeed: 0.625,
      abilityHaste: 0,
      critChance: 0,
      magicResist: 30,
      moveSpeed: 330,
      maxHealth: 1000,
      currentHealth: 1000,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// summarizeLifecycleEvent
// ---------------------------------------------------------------------------

describe("summarizeLifecycleEvent", () => {
  it("shows Connected/Disconnected for connection events", () => {
    expect(
      summarizeLifecycleEvent({ type: "connection", connected: true })
    ).toBe("Connected");
    expect(
      summarizeLifecycleEvent({ type: "connection", connected: false })
    ).toBe("Disconnected");
  });

  it("shows the phase name for phase events", () => {
    expect(
      summarizeLifecycleEvent({ type: "phase", phase: "ChampSelect" })
    ).toBe("Phase: ChampSelect");
  });

  // --- Lobby ---

  it("shows game mode for lobby events", () => {
    const event: GameLifecycleEvent = {
      type: "lobby",
      data: { gameConfig: { gameMode: "CLASSIC" } },
    };
    expect(summarizeLifecycleEvent(event)).toBe("Lobby: CLASSIC");
  });

  it("shows game mode and member count for lobby events with members", () => {
    const event: GameLifecycleEvent = {
      type: "lobby",
      data: {
        gameConfig: { gameMode: "ARAM" },
        members: [{}, {}, {}],
      },
    };
    expect(summarizeLifecycleEvent(event)).toBe("Lobby: ARAM, 3 members");
  });

  it("falls back to generic lobby summary when data is missing", () => {
    const event: GameLifecycleEvent = { type: "lobby", data: {} };
    expect(summarizeLifecycleEvent(event)).toBe("Lobby update");
  });

  it("handles null lobby data gracefully", () => {
    const event: GameLifecycleEvent = { type: "lobby", data: null };
    expect(summarizeLifecycleEvent(event)).toBe("Lobby update");
  });

  // --- Session ---

  it("shows phase for session events", () => {
    const event: GameLifecycleEvent = {
      type: "session",
      data: { phase: "InProgress" },
    };
    expect(summarizeLifecycleEvent(event)).toBe("Session: InProgress");
  });

  it("shows phase and game mode for session events", () => {
    const event: GameLifecycleEvent = {
      type: "session",
      data: {
        phase: "ChampSelect",
        gameData: { queue: { gameMode: "ARAM" } },
      },
    };
    expect(summarizeLifecycleEvent(event)).toBe("Session: ChampSelect, ARAM");
  });

  it("falls back to generic session summary when data is missing", () => {
    const event: GameLifecycleEvent = { type: "session", data: {} };
    expect(summarizeLifecycleEvent(event)).toBe("Session update");
  });

  // --- Matchmaking ---

  it("shows search state for matchmaking events", () => {
    const event: GameLifecycleEvent = {
      type: "matchmaking",
      data: { searchState: "Searching" },
    };
    expect(summarizeLifecycleEvent(event)).toBe("Matchmaking: Searching");
  });

  it("shows search state and estimated time for matchmaking events", () => {
    const event: GameLifecycleEvent = {
      type: "matchmaking",
      data: { searchState: "Searching", estimatedQueueTime: 90 },
    };
    expect(summarizeLifecycleEvent(event)).toBe(
      "Matchmaking: Searching, est. 1:30"
    );
  });

  it("falls back to generic matchmaking summary when data is missing", () => {
    const event: GameLifecycleEvent = { type: "matchmaking", data: {} };
    expect(summarizeLifecycleEvent(event)).toBe("Matchmaking update");
  });
});

// ---------------------------------------------------------------------------
// summarizeLiveGameState
// ---------------------------------------------------------------------------

describe("summarizeLiveGameState", () => {
  it("returns default text when no data", () => {
    expect(summarizeLiveGameState(createDefaultLiveGameState())).toBe(
      "Default (no data)"
    );
  });

  it("indicates champ select active", () => {
    expect(
      summarizeLiveGameState(
        createDefaultLiveGameState({ champSelect: { myTeam: [] } })
      )
    ).toBe("Champ select active");
  });

  it("shows EOG win/loss", () => {
    const eogStats = {
      gameId: "123",
      gameLength: 1200,
      gameMode: "ARAM",
      isWin: true,
      championId: 103,
      items: [3089],
    };
    expect(
      summarizeLiveGameState(createDefaultLiveGameState({ eogStats }))
    ).toBe("EOG: WIN");
  });

  it("shows champion, level, time, mode, and player count", () => {
    const state = createDefaultLiveGameState({
      activePlayer: createActivePlayer({
        championName: "Ahri",
        level: 6,
      }),
      gameTime: 305,
      gameMode: "ARAM",
      players: [{} as never, {} as never, {} as never],
    });
    expect(summarizeLiveGameState(state)).toBe("Ahri | Lv6 | 5:05 | ARAM | 3p");
  });
});

// ---------------------------------------------------------------------------
// summarizeUserInput
// ---------------------------------------------------------------------------

describe("summarizeUserInput", () => {
  it("shows augment name", () => {
    const event: UserInputEvent = {
      type: "augment",
      augment: {
        name: "Blade Waltz",
        description: "desc",
        tier: "Gold",
        sets: [],
        mode: "mayhem",
      },
    };
    expect(summarizeUserInput(event)).toBe("Augment: Blade Waltz");
  });

  it("shows query text", () => {
    const event: UserInputEvent = { type: "query", text: "how do I play Ahri" };
    expect(summarizeUserInput(event)).toBe('Query: "how do I play Ahri"');
  });
});
