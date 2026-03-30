import { describe, it, expect, vi } from "vitest";
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

vi.mock("../data-ingest/champion-id-map", () => {
  const nameMap: Record<number, string> = {
    136: "Aurelion Sol",
    497: "Rakan",
    254: "Vi",
    202: "Jhin",
    68: "Rumble",
  };
  return {
    resolveChampionName: vi.fn((id: number) => nameMap[id]),
  };
});

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

  it("includes queue ID when present", () => {
    const event: GameLifecycleEvent = {
      type: "lobby",
      data: {
        gameConfig: { gameMode: "ARAM", queueId: 450 },
        members: [{}, {}],
      },
    };
    expect(summarizeLifecycleEvent(event)).toBe(
      "Lobby: ARAM (queue 450), 2 members"
    );
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

  it("includes map ID when present", () => {
    const event: GameLifecycleEvent = {
      type: "session",
      data: {
        phase: "InProgress",
        gameData: { queue: { gameMode: "CLASSIC" } },
        map: { mapId: 11 },
      },
    };
    expect(summarizeLifecycleEvent(event)).toBe(
      "Session: InProgress, CLASSIC, map 11"
    );
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

  it("shows your champion and allies during champ select", () => {
    const champSelect = {
      localPlayerCellId: 0,
      myTeam: [
        {
          cellId: 0,
          championId: 136,
          championPickIntent: 0,
          assignedPosition: "",
          gameName: "niftymonkey",
        },
        {
          cellId: 1,
          championId: 497,
          championPickIntent: 0,
          assignedPosition: "utility",
          gameName: "",
        },
        {
          cellId: 2,
          championId: 254,
          championPickIntent: 0,
          assignedPosition: "jungle",
          gameName: "",
        },
      ],
      theirTeam: [],
      timer: { phase: "BAN_PICK", adjustedTimeLeftInPhase: 25000 },
    };
    const result = summarizeLiveGameState(
      createDefaultLiveGameState({ champSelect })
    );
    expect(result).toContain("Champ Select");
    expect(result).toContain("You: Aurelion Sol");
    expect(result).toContain("Rakan (utility)");
    expect(result).toContain("Vi (jungle)");
    expect(result).toContain("BAN_PICK (25s)");
  });

  it("shows hovering intent when not locked in", () => {
    const champSelect = {
      localPlayerCellId: 0,
      myTeam: [
        {
          cellId: 0,
          championId: 0,
          championPickIntent: 202,
          assignedPosition: "",
        },
      ],
      theirTeam: [],
      timer: { phase: "BAN_PICK", adjustedTimeLeftInPhase: 60000 },
    };
    const result = summarizeLiveGameState(
      createDefaultLiveGameState({ champSelect })
    );
    expect(result).toContain("Hovering: Jhin");
  });

  it("falls back gracefully when champSelect has no team data", () => {
    expect(
      summarizeLiveGameState(createDefaultLiveGameState({ champSelect: {} }))
    ).toBe("Champ Select");
  });

  it("shows EOG with game mode and duration", () => {
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
    ).toBe("EOG: WIN | ARAM | 20:00");
  });

  it("shows EOG loss", () => {
    const eogStats = {
      gameId: "456",
      gameLength: 900,
      gameMode: "CHERRY",
      isWin: false,
      championId: 222,
      items: [],
    };
    expect(
      summarizeLiveGameState(createDefaultLiveGameState({ eogStats }))
    ).toBe("EOG: LOSS | CHERRY | 15:00");
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
  it("shows augment name and tier", () => {
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
    expect(summarizeUserInput(event)).toBe(
      "Augment picked: Blade Waltz (Gold)"
    );
  });

  it("shows augment name with tier", () => {
    const event: UserInputEvent = {
      type: "augment",
      augment: {
        name: "Blade Waltz",
        description: "desc",
        tier: "Silver",
        sets: [],
        mode: "mayhem",
      },
    };
    expect(summarizeUserInput(event)).toBe(
      "Augment picked: Blade Waltz (Silver)"
    );
  });

  it("shows query text", () => {
    const event: UserInputEvent = { type: "query", text: "how do I play Ahri" };
    expect(summarizeUserInput(event)).toBe('Query: "how do I play Ahri"');
  });
});
