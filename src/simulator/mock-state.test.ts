import { describe, it, expect } from "vitest";
import { createMockGameState, createMockEogStats } from "./mock-state";
import type { LoadedGameData } from "../lib/data-ingest";
import type { Champion } from "../lib/data-ingest/types";

function createTestGameData(): LoadedGameData {
  const champions = new Map<string, Champion>();

  // Add enough champions for a 10-player game
  const champList = [
    { name: "Ahri", tags: ["Mage", "Assassin"], partype: "Mana" },
    { name: "Garen", tags: ["Fighter", "Tank"], partype: "None" },
    { name: "Zed", tags: ["Assassin"], partype: "Energy" },
    { name: "Sona", tags: ["Mage", "Support"], partype: "Mana" },
    { name: "Jinx", tags: ["Marksman"], partype: "Mana" },
    { name: "Thresh", tags: ["Support", "Fighter"], partype: "Mana" },
    { name: "Darius", tags: ["Fighter", "Tank"], partype: "Mana" },
    { name: "Lux", tags: ["Mage", "Support"], partype: "Mana" },
    { name: "Vayne", tags: ["Marksman", "Assassin"], partype: "Mana" },
    { name: "Malphite", tags: ["Tank", "Fighter"], partype: "Mana" },
  ];

  for (const c of champList) {
    champions.set(c.name.toLowerCase(), {
      id: c.name,
      key: 0,
      name: c.name,
      title: "",
      tags: c.tags,
      partype: c.partype,
      stats: {
        hp: 590,
        hpperlevel: 96,
        mp: 418,
        mpperlevel: 25,
        movespeed: 330,
        armor: 21,
        armorperlevel: 4.7,
        spellblock: 30,
        spellblockperlevel: 1.3,
        attackrange: 550,
        hpregen: 2.5,
        hpregenperlevel: 0.6,
        mpregen: 8,
        mpregenperlevel: 0.8,
        attackdamage: 53,
        attackdamageperlevel: 3,
        attackspeed: 0.668,
        attackspeedperlevel: 2,
      },
      image: "",
    });
  }

  return {
    version: "16.7.1",
    champions,
    items: new Map(),
    runes: [],
    augments: new Map(),
    augmentSets: [],
    dictionary: {
      allNames: [],
      champions: [],
      items: [],
      augments: [],
      search: () => [],
      findInText: () => [],
    },
  };
}

describe("createMockGameState", () => {
  it("creates a state with the specified champion as active player", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "KIWI" },
      createTestGameData()
    );
    expect(state.activePlayer).not.toBeNull();
    expect(state.activePlayer!.championName).toBe("Ahri");
  });

  it("populates 10 players total", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "KIWI" },
      createTestGameData()
    );
    expect(state.players.length).toBe(10);
  });

  it("marks one player as active", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "KIWI" },
      createTestGameData()
    );
    const activePlayers = state.players.filter((p) => p.isActivePlayer);
    expect(activePlayers.length).toBe(1);
    expect(activePlayers[0].championName).toBe("Ahri");
  });

  it("splits players into ORDER and CHAOS teams", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "KIWI" },
      createTestGameData()
    );
    const order = state.players.filter((p) => p.team === "ORDER");
    const chaos = state.players.filter((p) => p.team === "CHAOS");
    expect(order.length).toBe(5);
    expect(chaos.length).toBe(5);
  });

  it("sets the game mode string", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "ARAM" },
      createTestGameData()
    );
    expect(state.gameMode).toBe("ARAM");
    expect(state.lcuGameMode).toBe("ARAM");
  });

  it("uses provided level, gold, and game time", () => {
    const state = createMockGameState(
      {
        championName: "Ahri",
        gameMode: "KIWI",
        level: 12,
        gold: 3500,
        gameTime: 600,
      },
      createTestGameData()
    );
    expect(state.activePlayer!.level).toBe(12);
    expect(state.activePlayer!.currentGold).toBe(3500);
    expect(state.gameTime).toBe(600);
  });

  it("uses provided KDA", () => {
    const state = createMockGameState(
      {
        championName: "Ahri",
        gameMode: "KIWI",
        kills: 5,
        deaths: 2,
        assists: 8,
      },
      createTestGameData()
    );
    const active = state.players.find((p) => p.isActivePlayer)!;
    expect(active.kills).toBe(5);
    expect(active.deaths).toBe(2);
    expect(active.assists).toBe(8);
  });

  it("computes realistic active player stats from champion data", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "KIWI", level: 10 },
      createTestGameData()
    );
    // Stats should be computed, not zero
    expect(state.activePlayer!.stats.maxHealth).toBeGreaterThan(0);
    expect(state.activePlayer!.stats.attackDamage).toBeGreaterThan(0);
    expect(state.activePlayer!.stats.armor).toBeGreaterThan(0);
  });

  it("defaults to level 3, 1400 gold, 0 game time", () => {
    const state = createMockGameState(
      { championName: "Ahri", gameMode: "KIWI" },
      createTestGameData()
    );
    expect(state.activePlayer!.level).toBe(3);
    expect(state.activePlayer!.currentGold).toBe(1400);
    expect(state.gameTime).toBe(0);
  });
});

describe("createMockEogStats", () => {
  it("creates EOG stats with win/loss", () => {
    const eog = createMockEogStats({
      isWin: true,
      championName: "Ahri",
    });
    expect(eog).not.toBeNull();
    expect(eog!.isWin).toBe(true);
  });

  it("creates EOG stats with defeat", () => {
    const eog = createMockEogStats({
      isWin: false,
      championName: "Ahri",
    });
    expect(eog!.isWin).toBe(false);
  });

  it("uses provided game length", () => {
    const eog = createMockEogStats({
      isWin: true,
      championName: "Ahri",
      gameLength: 1800,
    });
    expect(eog!.gameLength).toBe(1800);
  });

  it("defaults game length to 1200 seconds", () => {
    const eog = createMockEogStats({
      isWin: true,
      championName: "Ahri",
    });
    expect(eog!.gameLength).toBe(1200);
  });
});
