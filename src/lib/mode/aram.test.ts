import { describe, it, expect } from "vitest";
import { aramMode } from "./aram";
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
        team: "CHAOS",
        level: 9,
        kills: 3,
        deaths: 4,
        assists: 6,
        items: [{ id: 3075, name: "Thornmail" }],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Enemy1",
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

describe("aramMode", () => {
  it("has correct id and display name", () => {
    expect(aramMode.id).toBe("aram");
    expect(aramMode.displayName).toBe("ARAM");
  });

  it("declares item-purchase and open-ended-coaching decision types only", () => {
    expect(aramMode.decisionTypes).toContain("item-purchase");
    expect(aramMode.decisionTypes).toContain("open-ended-coaching");
    expect(aramMode.decisionTypes).not.toContain("augment-selection");
  });

  it("has no augment selection levels", () => {
    expect(aramMode.augmentSelectionLevels).toEqual([]);
  });

  describe("matches", () => {
    it("matches ARAM game mode", () => {
      expect(aramMode.matches("ARAM")).toBe(true);
    });

    it("does not match KIWI (Mayhem)", () => {
      expect(aramMode.matches("KIWI")).toBe(false);
    });

    it("does not match other game modes", () => {
      expect(aramMode.matches("CLASSIC")).toBe(false);
      expect(aramMode.matches("CHERRY")).toBe(false);
    });
  });

  describe("buildContext", () => {
    it("includes balance overrides from champion data", () => {
      const ctx = aramMode.buildContext(createGameState(), createGameData());
      const ahri = ctx.playerContexts.get("Player1");
      expect(ahri!.balanceOverrides).toEqual({
        dmgDealt: 1.0,
        dmgTaken: 0.95,
      });
    });

    it("returns empty augment maps", () => {
      const ctx = aramMode.buildContext(createGameState(), createGameData());
      expect(ctx.modeAugments.size).toBe(0);
    });

    it("returns empty augment sets", () => {
      const ctx = aramMode.buildContext(createGameState(), createGameData());
      expect(ctx.augmentSets).toEqual([]);
    });

    it("filters items to ARAM mode", () => {
      const ctx = aramMode.buildContext(createGameState(), createGameData());
      expect(ctx.modeItems.size).toBe(1);
      expect(ctx.modeItems.has(328001)).toBe(true);
    });

    it("references itself as the mode", () => {
      const ctx = aramMode.buildContext(createGameState(), createGameData());
      expect(ctx.mode).toBe(aramMode);
    });
  });
});
