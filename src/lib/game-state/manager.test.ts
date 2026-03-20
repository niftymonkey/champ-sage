import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameStateManager, type RiotApiFetcher } from "./manager";
import type { GameState } from "./types";

const SAMPLE_RESPONSE = {
  activePlayer: {
    riotIdGameName: "TestPlayer",
    level: 5,
    currentGold: 1000,
    fullRunes: {
      keystone: { displayName: "Electrocute" },
      primaryRuneTree: { displayName: "Domination" },
      secondaryRuneTree: { displayName: "Precision" },
      generalRunes: [],
    },
    championStats: {
      abilityPower: 0,
      armor: 30,
      attackDamage: 60,
      attackSpeed: 0.65,
      abilityHaste: 0,
      critChance: 0,
      magicResist: 30,
      moveSpeed: 340,
      maxHealth: 800,
      currentHealth: 800,
    },
  },
  allPlayers: [
    {
      championName: "Aatrox",
      team: "ORDER",
      level: 5,
      riotIdGameName: "TestPlayer",
      scores: { kills: 1, deaths: 0, assists: 2 },
      items: [],
      summonerSpells: {
        summonerSpellOne: { displayName: "Flash" },
        summonerSpellTwo: { displayName: "Ignite" },
      },
    },
  ],
  gameData: { gameMode: "ARAM", gameTime: 120 },
};

describe("GameStateManager", () => {
  let manager: GameStateManager;
  let mockFetcher: ReturnType<typeof vi.fn<RiotApiFetcher>>;

  beforeEach(() => {
    mockFetcher = vi.fn();
    manager = new GameStateManager(mockFetcher);
  });

  afterEach(() => {
    manager.stop();
  });

  it("starts in disconnected state", () => {
    const state = manager.getState();
    expect(state.status).toBe("disconnected");
    expect(state.activePlayer).toBeNull();
    expect(state.players).toEqual([]);
  });

  it("transitions to connected when fetcher returns data", async () => {
    mockFetcher.mockResolvedValueOnce(SAMPLE_RESPONSE);

    await manager.poll();
    const state = manager.getState();

    expect(state.status).toBe("connected");
    expect(state.activePlayer?.championName).toBe("Aatrox");
    expect(state.gameMode).toBe("ARAM");
  });

  it("transitions to loading when fetcher throws LOADING", async () => {
    mockFetcher.mockRejectedValueOnce(new Error("LOADING"));

    await manager.poll();
    expect(manager.getState().status).toBe("loading");
  });

  it("transitions to disconnected when fetcher throws other error", async () => {
    mockFetcher.mockRejectedValueOnce(new Error("CONNECTION_FAILED"));

    await manager.poll();
    expect(manager.getState().status).toBe("disconnected");
  });

  it("notifies subscribers on state change", async () => {
    const subscriber = vi.fn();
    manager.subscribe(subscriber);

    mockFetcher.mockResolvedValueOnce(SAMPLE_RESPONSE);

    await manager.poll();
    expect(subscriber).toHaveBeenCalledTimes(1);

    const state: GameState = subscriber.mock.calls[0][0];
    expect(state.status).toBe("connected");
  });

  it("does not notify subscribers when state hasn't changed", async () => {
    const subscriber = vi.fn();
    manager.subscribe(subscriber);

    mockFetcher.mockRejectedValue(new Error("CONNECTION_FAILED"));

    // Already disconnected, poll returns disconnected again
    await manager.poll();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("allows unsubscribing", async () => {
    const subscriber = vi.fn();
    const unsubscribe = manager.subscribe(subscriber);
    unsubscribe();

    mockFetcher.mockResolvedValueOnce(SAMPLE_RESPONSE);

    await manager.poll();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("transitions back to disconnected when game ends", async () => {
    // First: game is running
    mockFetcher.mockResolvedValueOnce(SAMPLE_RESPONSE);
    await manager.poll();
    expect(manager.getState().status).toBe("connected");

    // Then: game ends
    mockFetcher.mockRejectedValueOnce(new Error("CONNECTION_FAILED"));
    await manager.poll();
    expect(manager.getState().status).toBe("disconnected");
    expect(manager.getState().activePlayer).toBeNull();
  });
});
