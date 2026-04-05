import { describe, it, expect } from "vitest";
import { aramMayhemMode } from "./aram-mayhem";
import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { Augment, AugmentSet, Champion, Item } from "../data-ingest/types";

function createGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: "connected",
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
      {
        championName: "Sona",
        team: "CHAOS",
        level: 8,
        kills: 1,
        deaths: 5,
        assists: 12,
        items: [{ id: 3504, name: "Ardent Censer" }],
        summonerSpells: ["Flash", "Heal"],
        riotIdGameName: "Enemy2",
        position: "",
        isActivePlayer: false,
      },
    ],
    gameMode: "ARAM",
    gameTime: 600,
    ...overrides,
  };
}

function createGameData(): LoadedGameData {
  const champions = new Map<string, Champion>([
    [
      "ahri",
      {
        id: "Ahri",
        key: 103,
        name: "Ahri",
        title: "the Nine-Tailed Fox",
        tags: ["Mage", "Assassin"],
        partype: "Mana",
        stats: {} as Champion["stats"],
        image: "",
        aramOverrides: { dmgDealt: 1.0, dmgTaken: 0.95 },
      },
    ],
    [
      "garen",
      {
        id: "Garen",
        key: 86,
        name: "Garen",
        title: "The Might of Demacia",
        tags: ["Fighter", "Tank"],
        partype: "None",
        stats: {} as Champion["stats"],
        image: "",
        aramOverrides: { dmgDealt: 1.05, dmgTaken: 1.05 },
      },
    ],
    [
      "vayne",
      {
        id: "Vayne",
        key: 67,
        name: "Vayne",
        title: "the Night Hunter",
        tags: ["Marksman", "Assassin"],
        partype: "Mana",
        stats: {} as Champion["stats"],
        image: "",
        aramOverrides: { dmgDealt: 0.95, dmgTaken: 1.05 },
      },
    ],
    [
      "sona",
      {
        id: "Sona",
        key: 37,
        name: "Sona",
        title: "Maven of the Strings",
        tags: ["Mage", "Support"],
        partype: "Mana",
        stats: {} as Champion["stats"],
        image: "",
        aramOverrides: { dmgDealt: 0.9, dmgTaken: 1.1, healing: 0.6 },
      },
    ],
  ]);

  const items = new Map<number, Item>([
    [
      328001,
      {
        id: 328001,
        name: "ARAM Boots",
        description: "ARAM variant",
        plaintext: "",
        gold: { base: 300, total: 300, sell: 210, purchasable: true },
        tags: [],
        stats: {},
        image: "",
        mode: "aram",
      },
    ],
    [
      3089,
      {
        id: 3089,
        name: "Rabadon's Deathcap",
        description: "AP",
        plaintext: "",
        gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
        tags: [],
        stats: {},
        image: "",
        mode: "standard",
      },
    ],
  ]);

  const augments = new Map<string, Augment>([
    [
      "typhoon",
      {
        name: "Typhoon",
        description: "Storm damage",
        tier: "Silver",
        sets: ["Firecracker"],
        mode: "mayhem",
      },
    ],
    [
      "arena:blade waltz",
      {
        name: "Blade Waltz",
        description: "Attack speed",
        tier: "Silver",
        sets: [],
        mode: "arena",
      },
    ],
  ]);

  const augmentSets: AugmentSet[] = [
    {
      name: "Firecracker",
      bonuses: [
        { threshold: 2, description: "Firecrackers bounce to 2 enemies" },
      ],
    },
  ];

  return {
    version: "16.6.1",
    champions,
    items,
    runes: [],
    augments,
    augmentSets,
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

describe("aramMayhemMode", () => {
  it("has correct id and display name", () => {
    expect(aramMayhemMode.id).toBe("aram-mayhem");
    expect(aramMayhemMode.displayName).toBe("ARAM Mayhem");
  });

  it("declares augment-selection, item-purchase, and open-ended-coaching decision types", () => {
    expect(aramMayhemMode.decisionTypes).toContain("augment-selection");
    expect(aramMayhemMode.decisionTypes).toContain("item-purchase");
    expect(aramMayhemMode.decisionTypes).toContain("open-ended-coaching");
  });

  describe("matches", () => {
    it("matches KIWI (Mayhem) game mode", () => {
      expect(aramMayhemMode.matches("KIWI")).toBe(true);
    });

    it("does not match straight ARAM", () => {
      expect(aramMayhemMode.matches("ARAM")).toBe(false);
    });

    it("does not match other game modes", () => {
      expect(aramMayhemMode.matches("CLASSIC")).toBe(false);
      expect(aramMayhemMode.matches("CHERRY")).toBe(false);
      expect(aramMayhemMode.matches("")).toBe(false);
    });
  });

  describe("buildContext", () => {
    it("builds player contexts for all players", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.playerContexts.size).toBe(4);
    });

    it("includes champion tags from game data", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      const ahri = ctx.playerContexts.get("Player1");
      expect(ahri).toBeDefined();
      expect(ahri!.tags).toEqual(["Mage", "Assassin"]);
    });

    it("includes ARAM balance overrides from champion data", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      const sona = ctx.playerContexts.get("Enemy2");
      expect(sona).toBeDefined();
      expect(sona!.balanceOverrides).toEqual({
        dmgDealt: 0.9,
        dmgTaken: 1.1,
        healing: 0.6,
      });
    });

    it("sets null balance overrides when champion not found in game data", () => {
      const gameData = createGameData();
      gameData.champions.delete("ahri");
      const ctx = aramMayhemMode.buildContext(createGameState(), gameData);
      const ahri = ctx.playerContexts.get("Player1");
      expect(ahri!.balanceOverrides).toBeNull();
    });

    it("filters items to ARAM mode only", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.modeItems.size).toBe(1);
      expect(ctx.modeItems.has(328001)).toBe(true);
      expect(ctx.modeItems.has(3089)).toBe(false);
    });

    it("filters augments to mayhem mode only", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.modeAugments.size).toBe(1);
      expect(ctx.modeAugments.has("typhoon")).toBe(true);
      expect(ctx.modeAugments.has("arena:blade waltz")).toBe(false);
    });

    it("includes augment sets from game data", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.augmentSets).toHaveLength(1);
      expect(ctx.augmentSets[0].name).toBe("Firecracker");
    });

    it("builds ally team composition", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.allyTeamComp.players).toHaveLength(2);
      expect(ctx.allyTeamComp.classCounts).toEqual({
        Mage: 1,
        Assassin: 1,
        Fighter: 1,
        Tank: 1,
      });
    });

    it("builds enemy team composition", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.enemyTeamComp.players).toHaveLength(2);
      expect(ctx.enemyTeamComp.classCounts).toEqual({
        Marksman: 1,
        Assassin: 1,
        Mage: 1,
        Support: 1,
      });
    });

    it("initializes selected augments as empty", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      const ahri = ctx.playerContexts.get("Player1");
      expect(ahri!.selectedAugments).toEqual([]);
    });

    it("initializes set progress as empty", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      const ahri = ctx.playerContexts.get("Player1");
      expect(ahri!.setProgress).toEqual([]);
    });

    it("references the mode itself", () => {
      const ctx = aramMayhemMode.buildContext(
        createGameState(),
        createGameData()
      );
      expect(ctx.mode).toBe(aramMayhemMode);
    });

    it("determines ally team from active player's team", () => {
      const gameState = createGameState();
      // Active player is on ORDER
      const ctx = aramMayhemMode.buildContext(gameState, createGameData());
      for (const player of ctx.allyTeamComp.players) {
        expect(player.team).toBe("ORDER");
      }
      for (const player of ctx.enemyTeamComp.players) {
        expect(player.team).toBe("CHAOS");
      }
    });
  });
});
