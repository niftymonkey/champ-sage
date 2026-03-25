import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import { ReactiveEngine } from "./engine";
import {
  gameLifecycle$,
  liveGameState$,
  createDefaultLiveGameState,
  notifications$,
  userInput$,
  manualInput$,
  playerIntent$,
} from "./streams";
import type {
  TauriBridge,
  LcuEventPayload,
  LcuDisconnectPayload,
} from "./tauri-bridge";
import type {
  GameLifecycleEvent,
  AppNotification,
  UserInputEvent,
} from "./types";

// ---------------------------------------------------------------------------
// Mock bridge factory
// ---------------------------------------------------------------------------

interface MockBridge extends TauriBridge {
  simulateLcuEvent(event: LcuEventPayload): void;
  simulateDisconnect(reason: string): void;
  setLcuAvailable(port: number, token: string): void;
  setLcuUnavailable(): void;
  setRiotApiResponse(response: unknown): void;
  setRiotApiError(error: string): void;
  setFetchLcuResponse(response: unknown): void;
  setFetchLcuError(error: string): void;
}

function createMockBridge(): MockBridge {
  let lcuAvailable = false;
  let lcuPort = 0;
  let lcuToken = "";
  let riotApiResponse: unknown = null;
  let riotApiError: string | null = null;
  let fetchLcuResponse: unknown = null;
  let fetchLcuError: string | null = null;
  let eventHandler: ((event: LcuEventPayload) => void) | null = null;
  let disconnectHandler: ((event: LcuDisconnectPayload) => void) | null = null;

  const bridge: MockBridge = {
    discoverLcu: vi.fn(async () => {
      if (!lcuAvailable) {
        throw new Error("Lockfile not found");
      }
      return { port: lcuPort, token: lcuToken };
    }),

    fetchLcu: vi.fn(
      async (_port: number, _token: string, _endpoint: string) => {
        if (fetchLcuError) throw new Error(fetchLcuError);
        return JSON.stringify(fetchLcuResponse);
      }
    ),

    fetchRiotApi: vi.fn(async (_endpoint: string) => {
      if (riotApiError) throw new Error(riotApiError);
      return JSON.stringify(riotApiResponse);
    }),

    connectLcuWebSocket: vi.fn(async () => {}),

    listenLcuEvent: vi.fn(async (handler) => {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    }),

    listenLcuDisconnect: vi.fn(async (handler) => {
      disconnectHandler = handler;
      return () => {
        disconnectHandler = null;
      };
    }),

    simulateLcuEvent(event: LcuEventPayload) {
      eventHandler?.(event);
    },

    simulateDisconnect(reason: string) {
      disconnectHandler?.({ reason });
    },

    setLcuAvailable(port: number, token: string) {
      lcuAvailable = true;
      lcuPort = port;
      lcuToken = token;
    },

    setLcuUnavailable() {
      lcuAvailable = false;
    },

    setRiotApiResponse(response: unknown) {
      riotApiResponse = response;
      riotApiError = null;
    },

    setRiotApiError(error: string) {
      riotApiError = error;
    },

    setFetchLcuResponse(response: unknown) {
      fetchLcuResponse = response;
      fetchLcuError = null;
    },

    setFetchLcuError(error: string) {
      fetchLcuError = error;
    },
  };

  return bridge;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect emissions from gameLifecycle$ into an array. */
function collectLifecycleEvents(): {
  events: GameLifecycleEvent[];
  teardown: () => void;
} {
  const events: GameLifecycleEvent[] = [];
  const sub = gameLifecycle$.subscribe((e) => events.push(e));
  return { events, teardown: () => sub.unsubscribe() };
}

/** Create a minimal valid Riot API response for normalizeGameState. */
function createRiotApiResponse(
  overrides: {
    gameTime?: number;
    gameMode?: string;
    championName?: string;
  } = {}
) {
  return {
    activePlayer: {
      riotIdGameName: "TestPlayer",
      level: 6,
      currentGold: 1500,
      fullRunes: {
        keystone: { displayName: "Conqueror" },
        primaryRuneTree: { displayName: "Precision" },
        secondaryRuneTree: { displayName: "Resolve" },
      },
      championStats: {
        abilityPower: 0,
        armor: 30,
        attackDamage: 70,
        attackSpeed: 1.0,
        abilityHaste: 0,
        critChance: 0,
        magicResist: 30,
        moveSpeed: 340,
        maxHealth: 800,
        currentHealth: 750,
      },
    },
    allPlayers: [
      {
        championName: overrides.championName ?? "Garen",
        team: "ORDER",
        level: 6,
        riotIdGameName: "TestPlayer",
        position: "TOP",
        scores: { kills: 2, deaths: 1, assists: 3 },
        items: [],
        summonerSpells: {
          summonerSpellOne: { displayName: "Flash" },
          summonerSpellTwo: { displayName: "Ignite" },
        },
      },
    ],
    gameData: {
      gameMode: overrides.gameMode ?? "CLASSIC",
      gameTime: overrides.gameTime ?? 300,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReactiveEngine", () => {
  let bridge: MockBridge;
  let engine: ReactiveEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = createMockBridge();
    engine = new ReactiveEngine(bridge);

    // Reset subjects to defaults
    gameLifecycle$.next({ type: "connection", connected: false });
    liveGameState$.next(createDefaultLiveGameState());
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();

    // Reset subjects
    gameLifecycle$.next({ type: "connection", connected: false });
    liveGameState$.next(createDefaultLiveGameState());
  });

  // =========================================================================
  // LCU Connection
  // =========================================================================

  describe("LCU Connection", () => {
    it("emits disconnected when lockfile not found", async () => {
      bridge.setLcuUnavailable();

      const { events, teardown } = collectLifecycleEvents();
      engine.start();

      // startWith(0) fires immediately
      await vi.advanceTimersByTimeAsync(0);

      const connectionEvents = events.filter((e) => e.type === "connection");
      expect(connectionEvents).toContainEqual({
        type: "connection",
        connected: false,
      });

      teardown();
    });

    it("emits connected when lockfile discovered", async () => {
      bridge.setLcuAvailable(12345, "secret");

      const { events, teardown } = collectLifecycleEvents();
      engine.start();

      await vi.advanceTimersByTimeAsync(0);

      const connectionEvents = events.filter((e) => e.type === "connection");
      expect(connectionEvents).toContainEqual({
        type: "connection",
        connected: true,
      });

      teardown();
    });

    it("polls discovery every 3s", async () => {
      bridge.setLcuUnavailable();
      engine.start();

      await vi.advanceTimersByTimeAsync(0); // initial
      expect(bridge.discoverLcu).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3000);
      expect(bridge.discoverLcu).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(3000);
      expect(bridge.discoverLcu).toHaveBeenCalledTimes(3);
    });

    it("connects WebSocket when LCU discovered", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(bridge.connectLcuWebSocket).toHaveBeenCalledWith(12345, "secret");
    });

    it("retries WebSocket connection after failure", async () => {
      bridge.setLcuAvailable(12345, "secret");

      // First connection attempt fails
      (bridge.connectLcuWebSocket as Mock).mockRejectedValueOnce(
        new Error("Connection refused")
      );

      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(bridge.connectLcuWebSocket).toHaveBeenCalledTimes(1);

      // After retry delay (3s = next discovery tick), should retry
      await vi.advanceTimersByTimeAsync(3000);

      expect(bridge.connectLcuWebSocket).toHaveBeenCalledTimes(2);
    });

    it("fetches initial phase via REST on connect", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setFetchLcuResponse("None");
      engine.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(bridge.fetchLcu).toHaveBeenCalledWith(
        12345,
        "secret",
        "/lol-gameflow/v1/gameflow-phase"
      );
    });

    it("starts polling when initial phase is InProgress", async () => {
      bridge.setLcuAvailable(12345, "secret");
      // fetchLcu returns "InProgress" for phase query
      (bridge.fetchLcu as Mock).mockImplementation(
        async (_port: number, _token: string, endpoint: string) => {
          if (endpoint === "/lol-gameflow/v1/gameflow-phase") {
            return JSON.stringify("InProgress");
          }
          if (endpoint === "/lol-gameflow/v1/session") {
            return JSON.stringify({ phase: "InProgress" });
          }
          return "{}";
        }
      );
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 42 }));
      engine.start();

      await vi.advanceTimersByTimeAsync(0);
      // Allow the initial phase fetch + poll to complete
      await vi.advanceTimersByTimeAsync(0);

      const state = liveGameState$.getValue();
      expect(state.gameTime).toBe(42);
      expect(state.activePlayer).not.toBeNull();
    });
  });

  // =========================================================================
  // WebSocket Event Filtering
  // =========================================================================

  describe("WebSocket Event Filtering", () => {
    beforeEach(async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("filters noise events (patcher, data-store, etc)", async () => {
      const { events, teardown } = collectLifecycleEvents();
      const initialCount = events.length;

      bridge.simulateLcuEvent({
        uri: "/patcher/v1/products",
        event_type: "Update",
        data: {},
      });

      bridge.simulateLcuEvent({
        uri: "/data-store/v1/key",
        event_type: "Update",
        data: {},
      });

      bridge.simulateLcuEvent({
        uri: "/lol-patch/v1/status",
        event_type: "Update",
        data: {},
      });

      bridge.simulateLcuEvent({
        uri: "/entitlements/v1/token",
        event_type: "Update",
        data: {},
      });

      bridge.simulateLcuEvent({
        uri: "/lol-honor-v2/v1/status",
        event_type: "Update",
        data: {},
      });

      // No new events should have been emitted for noise URIs
      // (phase/lobby/matchmaking/session events are what get pushed)
      const newEvents = events.slice(initialCount);
      const noiseForwarded = newEvents.filter(
        (e) =>
          e.type === "phase" ||
          e.type === "lobby" ||
          e.type === "matchmaking" ||
          e.type === "session"
      );
      expect(noiseForwarded).toHaveLength(0);

      teardown();
    });

    it("passes through gameflow phase events", () => {
      const { events, teardown } = collectLifecycleEvents();
      const initialCount = events.length;

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "ChampSelect",
      });

      const phaseEvents = events
        .slice(initialCount)
        .filter((e) => e.type === "phase");
      expect(phaseEvents).toHaveLength(1);
      expect(phaseEvents[0]).toEqual({ type: "phase", phase: "ChampSelect" });

      teardown();
    });

    it("passes through lobby events", () => {
      const { events, teardown } = collectLifecycleEvents();
      const initialCount = events.length;

      const lobbyData = { gameConfig: { gameMode: "CLASSIC" } };
      bridge.simulateLcuEvent({
        uri: "/lol-lobby/v2/lobby",
        event_type: "Update",
        data: lobbyData,
      });

      const lobbyEvents = events
        .slice(initialCount)
        .filter((e) => e.type === "lobby");
      expect(lobbyEvents).toHaveLength(1);
      expect(lobbyEvents[0]).toEqual({ type: "lobby", data: lobbyData });

      teardown();
    });

    it("passes through matchmaking events", () => {
      const { events, teardown } = collectLifecycleEvents();
      const initialCount = events.length;

      const matchData = { estimatedQueueTime: 60 };
      bridge.simulateLcuEvent({
        uri: "/lol-matchmaking/v1/search",
        event_type: "Update",
        data: matchData,
      });

      const matchEvents = events
        .slice(initialCount)
        .filter((e) => e.type === "matchmaking");
      expect(matchEvents).toHaveLength(1);
      expect(matchEvents[0]).toEqual({ type: "matchmaking", data: matchData });

      teardown();
    });

    it("passes through session events", () => {
      const { events, teardown } = collectLifecycleEvents();
      const initialCount = events.length;

      const sessionData = { phase: "InProgress", map: { id: 11 } };
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/session",
        event_type: "Update",
        data: sessionData,
      });

      const sessionEvents = events
        .slice(initialCount)
        .filter((e) => e.type === "session");
      expect(sessionEvents).toHaveLength(1);
      expect(sessionEvents[0]).toEqual({ type: "session", data: sessionData });

      teardown();
    });
  });

  // =========================================================================
  // Game Lifecycle
  // =========================================================================

  describe("Game Lifecycle", () => {
    it("emits phase events to gameLifecycle$", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const { events, teardown } = collectLifecycleEvents();

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "Lobby",
      });

      expect(events).toContainEqual({ type: "phase", phase: "Lobby" });

      teardown();
    });

    it("emits connection events to gameLifecycle$", async () => {
      bridge.setLcuAvailable(12345, "secret");

      const { events, teardown } = collectLifecycleEvents();
      engine.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(events).toContainEqual({ type: "connection", connected: true });

      teardown();
    });

    it("deduplicates consecutive identical phases", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const { events, teardown } = collectLifecycleEvents();

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "Lobby",
      });

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "Lobby",
      });

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "Matchmaking",
      });

      const phaseEvents = events.filter((e) => e.type === "phase");
      // Should only see Lobby once, then Matchmaking
      expect(phaseEvents).toHaveLength(2);
      expect(phaseEvents[0]).toEqual({ type: "phase", phase: "Lobby" });
      expect(phaseEvents[1]).toEqual({ type: "phase", phase: "Matchmaking" });

      teardown();
    });

    it("emits lobby data to gameLifecycle$", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const { events, teardown } = collectLifecycleEvents();

      const lobbyData = { queueId: 420 };
      bridge.simulateLcuEvent({
        uri: "/lol-lobby/v2/lobby",
        event_type: "Update",
        data: lobbyData,
      });

      expect(events).toContainEqual({ type: "lobby", data: lobbyData });

      teardown();
    });

    it("emits matchmaking data to gameLifecycle$", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const { events, teardown } = collectLifecycleEvents();

      const matchData = { estimatedQueueTime: 30 };
      bridge.simulateLcuEvent({
        uri: "/lol-matchmaking/v1/search",
        event_type: "Update",
        data: matchData,
      });

      expect(events).toContainEqual({
        type: "matchmaking",
        data: matchData,
      });

      teardown();
    });

    it("emits session data to gameLifecycle$", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const { events, teardown } = collectLifecycleEvents();

      const sessionData = { phase: "ChampSelect" };
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/session",
        event_type: "Update",
        data: sessionData,
      });

      expect(events).toContainEqual({ type: "session", data: sessionData });

      teardown();
    });
  });

  // =========================================================================
  // Live Game State Polling
  // =========================================================================

  describe("Live Game State Polling", () => {
    it("does not poll when phase is not InProgress", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "Lobby",
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(bridge.fetchRiotApi).not.toHaveBeenCalled();
    });

    it("starts polling when phase transitions to InProgress", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(createRiotApiResponse());
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // First poll fires immediately (startWith(0))
      await vi.advanceTimersByTimeAsync(0);

      expect(bridge.fetchRiotApi).toHaveBeenCalledWith(
        "/liveclientdata/allgamedata"
      );
    });

    it("stops polling when phase transitions away from InProgress", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(createRiotApiResponse());
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      // Enter InProgress
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      const callsAfterStart = (bridge.fetchRiotApi as Mock).mock.calls.length;

      // Leave InProgress
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "PreEndOfGame",
      });

      await vi.advanceTimersByTimeAsync(5000);

      // No additional poll calls
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsAfterStart
      );
    });

    it("normalizes API response into LiveGameState", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(
        createRiotApiResponse({ gameTime: 120, gameMode: "CLASSIC" })
      );
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      const state = liveGameState$.getValue();
      expect(state.gameTime).toBe(120);
      expect(state.gameMode).toBe("CLASSIC");
      expect(state.activePlayer).not.toBeNull();
      expect(state.activePlayer?.championName).toBe("Garen");
    });

    it("accumulates state via scan", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 100 }));
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(liveGameState$.getValue().gameTime).toBe(100);

      // Update response and poll again
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 200 }));
      await vi.advanceTimersByTimeAsync(2000);

      expect(liveGameState$.getValue().gameTime).toBe(200);
    });

    it("resets state when a new game starts (fresh switchMap)", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(
        createRiotApiResponse({ gameTime: 300, championName: "Garen" })
      );
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      // First game
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(liveGameState$.getValue().gameTime).toBe(300);

      // End first game
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "EndOfGame",
      });
      await vi.advanceTimersByTimeAsync(0);

      // State should be reset
      expect(liveGameState$.getValue().gameTime).toBe(0);
      expect(liveGameState$.getValue().activePlayer).toBeNull();

      // Second game
      bridge.setRiotApiResponse(
        createRiotApiResponse({ gameTime: 50, championName: "Darius" })
      );
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      // Should have fresh state from the new game
      expect(liveGameState$.getValue().gameTime).toBe(50);
      expect(liveGameState$.getValue().activePlayer?.championName).toBe(
        "Darius"
      );
    });

    it("silently skips poll failures", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // Should not throw
      await vi.advanceTimersByTimeAsync(0);

      // State should remain default
      expect(liveGameState$.getValue().activePlayer).toBeNull();

      // Now fix the API and poll again
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 60 }));
      await vi.advanceTimersByTimeAsync(2000);

      expect(liveGameState$.getValue().gameTime).toBe(60);
    });
  });

  // =========================================================================
  // End-of-Game Stats
  // =========================================================================

  describe("End-of-Game Stats", () => {
    it("fetches EOG stats on PreEndOfGame phase", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(createRiotApiResponse());
      bridge.setFetchLcuResponse({
        gameId: "12345",
        gameLength: 1800,
        gameMode: "CLASSIC",
        teams: [{ isWinningTeam: true }],
        localPlayer: { championId: 86, stats: { ITEM0: 1001, ITEM1: 3006 } },
      });
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      // Need to go InProgress first, then PreEndOfGame
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "PreEndOfGame",
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(bridge.fetchLcu).toHaveBeenCalledWith(
        12345,
        "secret",
        "/lol-end-of-game/v1/eog-stats-block"
      );
    });

    it("merges EOG stats into live game state", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 300 }));
      bridge.setFetchLcuResponse({
        gameId: "67890",
        gameLength: 1800,
        gameMode: "CLASSIC",
        teams: [{ isWinningTeam: true }],
        localPlayer: {
          championId: 86,
          stats: { ITEM0: 1001, ITEM1: 3006, ITEM2: 0 },
        },
      });
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      // Go through InProgress so we have live state
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      // Transition to PreEndOfGame
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "PreEndOfGame",
      });
      await vi.advanceTimersByTimeAsync(0);

      const state = liveGameState$.getValue();
      expect(state.eogStats).not.toBeNull();
      expect(state.eogStats?.gameId).toBe("67890");
      expect(state.eogStats?.isWin).toBe(true);
      expect(state.eogStats?.championId).toBe(86);
    });

    it("handles EOG fetch failure gracefully", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiResponse(createRiotApiResponse());
      bridge.setFetchLcuError("HTTP_500");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "PreEndOfGame",
      });
      await vi.advanceTimersByTimeAsync(0);

      // EOG stats should remain null
      expect(liveGameState$.getValue().eogStats).toBeNull();
    });
  });

  // =========================================================================
  // Error Recovery (Slice 5)
  // =========================================================================

  describe("Error Recovery", () => {
    it("counts consecutive poll failures", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // 5 polls: initial + 4 intervals (0, 2s, 4s, 6s, 8s)
      await vi.advanceTimersByTimeAsync(0); // initial
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(5);
      // State should still be default (all failures)
      expect(liveGameState$.getValue().activePlayer).toBeNull();
    });

    it("emits notification after 20 consecutive failures", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const notifs: AppNotification[] = [];
      const sub = notifications$.subscribe((n) => notifs.push(n));

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // 20 failures = initial + 19 intervals = 38s
      await vi.advanceTimersByTimeAsync(0); // poll 1
      for (let i = 1; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      const errorNotifs = notifs.filter((n) => n.level === "error");
      expect(errorNotifs.length).toBeGreaterThanOrEqual(1);
      expect(errorNotifs[0].id).toBe("live-data-connection");
      expect(errorNotifs[0].message).toContain("connection lost");

      sub.unsubscribe();
    });

    it("uses backoff retry after notification (30s, then 60s)", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // Exhaust the first 20 failures at 2s intervals (0 + 19*2s = 38s)
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 1; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      const callsAtThreshold = (bridge.fetchRiotApi as Mock).mock.calls.length;
      expect(callsAtThreshold).toBe(20);

      // After threshold, backoff should slow polling to 30s
      // Advance 29s — should NOT have polled yet
      await vi.advanceTimersByTimeAsync(29000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsAtThreshold
      );

      // Advance 1 more second (30s total) — should poll
      await vi.advanceTimersByTimeAsync(1000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsAtThreshold + 1
      );

      // Next backoff should be 60s
      await vi.advanceTimersByTimeAsync(59000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsAtThreshold + 1
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsAtThreshold + 2
      );
    });

    it("clears notification and resets counter on successful poll", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const notifs: AppNotification[] = [];
      const sub = notifications$.subscribe((n) => notifs.push(n));

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // 20 failures to trigger notification
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 1; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      const errorNotifs = notifs.filter((n) => n.level === "error");
      expect(errorNotifs.length).toBeGreaterThanOrEqual(1);

      // Now fix the API and let next backoff poll succeed
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 500 }));
      await vi.advanceTimersByTimeAsync(30000); // backoff poll

      const infoNotifs = notifs.filter((n) => n.level === "info");
      expect(infoNotifs.length).toBeGreaterThanOrEqual(1);
      expect(infoNotifs[0].id).toBe("live-data-recovery");
      expect(infoNotifs[0].message).toContain("restored");

      // Should resume normal 2s polling
      const callsAfterRecovery = (bridge.fetchRiotApi as Mock).mock.calls
        .length;
      await vi.advanceTimersByTimeAsync(2000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsAfterRecovery + 1
      );

      sub.unsubscribe();
    });

    it("clears failure state when phase changes away from InProgress", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const notifs: AppNotification[] = [];
      const sub = notifications$.subscribe((n) => notifs.push(n));

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // 20 failures to trigger notification
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 1; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      expect(notifs.some((n) => n.level === "error")).toBe(true);

      // Phase changes away from InProgress
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "PreEndOfGame",
      });
      await vi.advanceTimersByTimeAsync(0);

      // Notification should be cleared
      const clearNotifs = notifs.filter(
        (n) => n.id === "live-data-clear" && n.level === "info"
      );
      expect(clearNotifs.length).toBeGreaterThanOrEqual(1);

      // When re-entering InProgress, should start fresh with 2s polling
      bridge.setRiotApiResponse(createRiotApiResponse({ gameTime: 10 }));
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(liveGameState$.getValue().gameTime).toBe(10);

      sub.unsubscribe();
    });

    it("caps backoff at 60s", async () => {
      bridge.setLcuAvailable(12345, "secret");
      bridge.setRiotApiError("CONNECTION_FAILED");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });

      // 20 failures at 2s
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 1; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      // First backoff: 30s
      await vi.advanceTimersByTimeAsync(30000);
      // Second backoff: 60s
      await vi.advanceTimersByTimeAsync(60000);

      const callsBeforeCap = (bridge.fetchRiotApi as Mock).mock.calls.length;

      // Third backoff should still be 60s (capped), not 120s
      await vi.advanceTimersByTimeAsync(59000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsBeforeCap
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect((bridge.fetchRiotApi as Mock).mock.calls.length).toBe(
        callsBeforeCap + 1
      );
    });
  });

  // =========================================================================
  // User Input Routing (Slice 6)
  // =========================================================================

  describe("User Input", () => {
    it("routes manual augment input to userInput$", async () => {
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const events: UserInputEvent[] = [];
      const sub = userInput$.subscribe((e) => events.push(e));

      const augmentEvent = {
        type: "augment" as const,
        augment: {
          name: "Test Augment",
          description: "A test",
          tier: "Gold" as const,
          sets: [],
          mode: "arena" as const,
        },
      };
      manualInput$.next(augmentEvent);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(augmentEvent);

      sub.unsubscribe();
    });

    it("routes player intent to userInput$", async () => {
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const events: UserInputEvent[] = [];
      const sub = userInput$.subscribe((e) => events.push(e));

      const queryEvent = {
        type: "query" as const,
        text: "how do I play Garen?",
      };
      playerIntent$.next(queryEvent);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(queryEvent);

      sub.unsubscribe();
    });
  });

  // =========================================================================
  // Champ Select (Slice 6)
  // =========================================================================

  describe("Champ Select", () => {
    it("merges champ select data into liveGameState$", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      const champSelectData = {
        myTeam: [{ championId: 86, cellId: 0 }],
        theirTeam: [],
      };

      bridge.simulateLcuEvent({
        uri: "/lol-champ-select/v1/session",
        event_type: "Update",
        data: champSelectData,
      });

      const state = liveGameState$.getValue();
      expect(state.champSelect).toEqual(champSelectData);
    });

    it("clears champ select data when phase changes", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      // Set champ select data
      bridge.simulateLcuEvent({
        uri: "/lol-champ-select/v1/session",
        event_type: "Update",
        data: { myTeam: [{ championId: 86 }] },
      });

      expect(liveGameState$.getValue().champSelect).not.toBeNull();

      // Phase changes to InProgress
      bridge.setRiotApiResponse(createRiotApiResponse());
      bridge.simulateLcuEvent({
        uri: "/lol-gameflow/v1/gameflow-phase",
        event_type: "Update",
        data: "InProgress",
      });
      await vi.advanceTimersByTimeAsync(0);

      // champSelect should be cleared (reset by switchMap entering InProgress)
      // The InProgress scan starts with createDefaultLiveGameState which has champSelect: null
      expect(liveGameState$.getValue().champSelect).toBeNull();
    });
  });

  // =========================================================================
  // Cleanup
  // =========================================================================

  describe("Cleanup", () => {
    it("unsubscribes all subscriptions on stop()", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      engine.stop();

      // After stop, discovery should not continue polling
      const callsBefore = (bridge.discoverLcu as Mock).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      expect((bridge.discoverLcu as Mock).mock.calls.length).toBe(callsBefore);
    });

    it("can be restarted after stop", async () => {
      bridge.setLcuAvailable(12345, "secret");
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      engine.stop();

      // Collect before restart so we capture the connection event
      const { events, teardown } = collectLifecycleEvents();

      // Restart
      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should be polling again
      expect(events).toContainEqual({ type: "connection", connected: true });

      teardown();
    });
  });
});
