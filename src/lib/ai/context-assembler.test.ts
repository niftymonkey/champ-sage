import { describe, it, expect } from "vitest";
import { assembleContext } from "./context-assembler";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion } from "../data-ingest/types";

function createLiveGameState(
  overrides: Partial<LiveGameState> = {}
): LiveGameState {
  return {
    activePlayer: {
      championName: "Ahri",
      level: 10,
      currentGold: 2500,
      runes: {
        keystone: "Electrocute",
        primaryTree: "Domination",
        secondaryTree: "Sorcery",
      },
      stats: {
        abilityPower: 200,
        armor: 60,
        attackDamage: 80,
        attackSpeed: 0.8,
        abilityHaste: 30,
        critChance: 0,
        magicResist: 40,
        moveSpeed: 350,
        maxHealth: 1800,
        currentHealth: 1500,
      },
    },
    players: [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 10,
        kills: 5,
        deaths: 2,
        assists: 8,
        items: [{ id: 3089, name: "Rabadon's Deathcap" }],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Player1",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "Garen",
        team: "ORDER",
        level: 9,
        kills: 3,
        deaths: 4,
        assists: 6,
        items: [{ id: 3075, name: "Thornmail" }],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Player2",
        position: "",
        isActivePlayer: false,
      },
      {
        championName: "Vayne",
        team: "CHAOS",
        level: 11,
        kills: 8,
        deaths: 1,
        assists: 3,
        items: [{ id: 3153, name: "Blade of the Ruined King" }],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Enemy1",
        position: "",
        isActivePlayer: false,
      },
    ],
    gameMode: "ARAM",
    gameTime: 600,
    champSelect: null,
    eogStats: null,
    ...overrides,
  };
}

function createGameData(): LoadedGameData {
  const ahri: Champion = {
    id: "Ahri",
    key: 103,
    name: "Ahri",
    title: "the Nine-Tailed Fox",
    tags: ["Mage", "Assassin"],
    partype: "Mana",
    stats: {} as Champion["stats"],
    image: "",
    aramOverrides: { dmgDealt: 1.0, dmgTaken: 0.95 },
    abilities: {
      passive: {
        name: "Essence Theft",
        description: "Gains a charge on ability hit. At 3 charges, heals.",
      },
      spells: [
        {
          id: "AhriQ",
          name: "Orb of Deception",
          description:
            "Throws and pulls back an orb dealing magic then true damage.",
          maxRank: 5,
          cooldowns: [7, 7, 7, 7, 7],
          costs: [65, 70, 75, 80, 85],
          range: [880, 880, 880, 880, 880],
        },
      ],
    },
  };

  const champions = new Map<string, Champion>([["ahri", ahri]]);

  return {
    version: "14.10.1",
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
    },
  };
}

describe("assembleContext", () => {
  it("returns null when no active player", () => {
    const gameState = createLiveGameState({ activePlayer: null });
    const result = assembleContext(gameState, createGameData());
    expect(result).toBeNull();
  });

  it("assembles champion name and level from active player", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.champion.name).toBe("Ahri");
    expect(result!.champion.level).toBe(10);
  });

  it("includes champion abilities in context", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.champion.abilities).toContain("Orb of Deception");
    expect(result!.champion.abilities).toContain("Essence Theft");
  });

  it("includes current items from active player", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.currentItems).toContain("Rabadon's Deathcap");
  });

  it("includes enemy team with their items", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.enemyTeam).toHaveLength(1);
    expect(result!.enemyTeam[0].champion).toBe("Vayne");
    expect(result!.enemyTeam[0].items).toContain("Blade of the Ruined King");
  });

  it("includes ally team (excluding active player)", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.allyTeam).toHaveLength(1);
    expect(result!.allyTeam[0].champion).toBe("Garen");
  });

  it("includes game mode and time", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.gameMode).toBe("ARAM");
    expect(result!.gameTime).toBe(600);
  });

  it("includes ARAM balance overrides when applicable", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.balanceOverrides).not.toBeNull();
    expect(result!.balanceOverrides).toContain("-5%");
  });

  it("sets balanceOverrides to null when champion has no overrides", () => {
    const gameData = createGameData();
    const ahri = gameData.champions.get("ahri")!;
    delete ahri.aramOverrides;

    const result = assembleContext(createLiveGameState(), gameData);
    expect(result).not.toBeNull();
    expect(result!.balanceOverrides).toBeNull();
  });

  it("starts with empty currentAugments", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.currentAugments).toEqual([]);
  });
});
