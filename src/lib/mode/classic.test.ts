import { describe, it, expect } from "vitest";
import { classicMode } from "./classic";
import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion, Item } from "../data-ingest/types";

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
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "Player1",
        position: "MIDDLE",
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
        summonerSpells: ["Flash", "Teleport"],
        riotIdGameName: "Enemy1",
        position: "TOP",
        isActivePlayer: false,
      },
    ],
    gameMode: "CLASSIC",
    gameTime: 900,
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

  return {
    version: "16.6.1",
    champions,
    items,
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

describe("classicMode", () => {
  it("has correct id and display name", () => {
    expect(classicMode.id).toBe("classic");
    expect(classicMode.displayName).toBe("Classic");
  });

  it("declares item-purchase and open-ended-coaching decision types only", () => {
    expect(classicMode.decisionTypes).toContain("item-purchase");
    expect(classicMode.decisionTypes).toContain("open-ended-coaching");
    expect(classicMode.decisionTypes).not.toContain("augment-selection");
  });

  it("has no augment selection levels", () => {
    expect(classicMode.augmentSelectionLevels).toEqual([]);
  });

  describe("matches", () => {
    it("matches CLASSIC game mode", () => {
      expect(classicMode.matches("CLASSIC")).toBe(true);
    });

    it("does not match ARAM or KIWI", () => {
      expect(classicMode.matches("ARAM")).toBe(false);
      expect(classicMode.matches("KIWI")).toBe(false);
    });

    it("does not match other game modes", () => {
      expect(classicMode.matches("CHERRY")).toBe(false);
      expect(classicMode.matches("")).toBe(false);
    });
  });

  describe("buildContext", () => {
    it("sets null balance overrides for all players", () => {
      const ctx = classicMode.buildContext(createGameState(), createGameData());
      for (const [, player] of ctx.playerContexts) {
        expect(player.balanceOverrides).toBeNull();
      }
    });

    it("returns empty augment maps", () => {
      const ctx = classicMode.buildContext(createGameState(), createGameData());
      expect(ctx.modeAugments.size).toBe(0);
    });

    it("returns empty augment sets", () => {
      const ctx = classicMode.buildContext(createGameState(), createGameData());
      expect(ctx.augmentSets).toEqual([]);
    });

    it("filters items to standard mode", () => {
      const ctx = classicMode.buildContext(createGameState(), createGameData());
      expect(ctx.modeItems.has(3089)).toBe(true);
      expect(ctx.modeItems.has(328001)).toBe(false);
    });

    it("references itself as the mode", () => {
      const ctx = classicMode.buildContext(createGameState(), createGameData());
      expect(ctx.mode).toBe(classicMode);
    });
  });
});
