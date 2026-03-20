import { describe, it, expect } from "vitest";
import { normalizeGameState } from "./normalize";

const SAMPLE_API_RESPONSE = {
  activePlayer: {
    riotIdGameName: "TestPlayer",
    level: 8,
    currentGold: 2340,
    fullRunes: {
      keystone: { displayName: "Dark Harvest" },
      primaryRuneTree: { displayName: "Domination" },
      secondaryRuneTree: { displayName: "Sorcery" },
      generalRunes: [],
    },
    championStats: {
      abilityPower: 120,
      armor: 45,
      attackDamage: 75,
      attackSpeed: 0.8,
      abilityHaste: 20,
      critChance: 0,
      magicResist: 35,
      moveSpeed: 350,
      maxHealth: 1200,
      currentHealth: 950,
    },
  },
  allPlayers: [
    {
      championName: "Aurelion Sol",
      team: "ORDER",
      level: 8,
      riotIdGameName: "TestPlayer",
      scores: { kills: 3, deaths: 1, assists: 5 },
      items: [
        { itemID: 2508, displayName: "Fated Ashes" },
        { itemID: 3340, displayName: "Stealth Ward" },
      ],
      summonerSpells: {
        summonerSpellOne: { displayName: "Flash" },
        summonerSpellTwo: { displayName: "Ignite" },
      },
    },
    {
      championName: "Darius",
      team: "CHAOS",
      level: 7,
      riotIdGameName: "EnemyPlayer",
      scores: { kills: 2, deaths: 3, assists: 1 },
      items: [{ itemID: 1055, displayName: "Doran's Blade" }],
      summonerSpells: {
        summonerSpellOne: { displayName: "Flash" },
        summonerSpellTwo: { displayName: "Teleport" },
      },
    },
  ],
  gameData: {
    gameMode: "ARAM",
    gameTime: 542.5,
  },
};

describe("normalizeGameState", () => {
  it("normalizes a full API response into GameState", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);

    expect(state.status).toBe("connected");
    expect(state.gameMode).toBe("ARAM");
    expect(state.gameTime).toBe(542.5);
  });

  it("extracts active player data", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);
    const active = state.activePlayer;

    expect(active).not.toBeNull();
    expect(active!.championName).toBe("Aurelion Sol");
    expect(active!.level).toBe(8);
    expect(active!.currentGold).toBe(2340);
  });

  it("extracts active player runes", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);
    const runes = state.activePlayer!.runes;

    expect(runes.keystone).toBe("Dark Harvest");
    expect(runes.primaryTree).toBe("Domination");
    expect(runes.secondaryTree).toBe("Sorcery");
  });

  it("extracts active player stats", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);
    const stats = state.activePlayer!.stats;

    expect(stats.abilityPower).toBe(120);
    expect(stats.attackDamage).toBe(75);
    expect(stats.maxHealth).toBe(1200);
    expect(stats.moveSpeed).toBe(350);
  });

  it("normalizes all players with items and scores", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);

    expect(state.players).toHaveLength(2);
    expect(state.players[0].championName).toBe("Aurelion Sol");
    expect(state.players[0].team).toBe("ORDER");
    expect(state.players[0].kills).toBe(3);
    expect(state.players[0].items).toHaveLength(2);
    expect(state.players[0].items[0].name).toBe("Fated Ashes");
  });

  it("marks the active player in the players list", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);

    const active = state.players.find((p) => p.isActivePlayer);
    expect(active).toBeDefined();
    expect(active!.championName).toBe("Aurelion Sol");

    const enemy = state.players.find((p) => !p.isActivePlayer);
    expect(enemy).toBeDefined();
    expect(enemy!.championName).toBe("Darius");
  });

  it("extracts summoner spells", () => {
    const state = normalizeGameState(SAMPLE_API_RESPONSE);

    expect(state.players[0].summonerSpells).toEqual(["Flash", "Ignite"]);
    expect(state.players[1].summonerSpells).toEqual(["Flash", "Teleport"]);
  });

  it("resolves active player champion name from allPlayers", () => {
    // The activePlayer block in the API doesn't always have championName,
    // so we resolve it by matching riotIdGameName in allPlayers
    const state = normalizeGameState(SAMPLE_API_RESPONSE);

    expect(state.activePlayer!.championName).toBe("Aurelion Sol");
  });
});
