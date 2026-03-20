import { describe, it, expect } from "vitest";
import { buildEntityDictionary } from "./entity-dictionary";
import type { Champion, Item, Augment } from "./types";

const mockChampions = new Map<string, Champion>([
  [
    "aurelion sol",
    {
      id: "AurelionSol",
      key: 136,
      name: "Aurelion Sol",
      title: "The Star Forger",
      tags: ["Mage"],
      partype: "Mana",
      stats: {} as Champion["stats"],
      image: "",
    },
  ],
  [
    "miss fortune",
    {
      id: "MissFortune",
      key: 21,
      name: "Miss Fortune",
      title: "the Bounty Hunter",
      tags: ["Marksman"],
      partype: "Mana",
      stats: {} as Champion["stats"],
      image: "",
    },
  ],
]);

const mockItems = new Map<number, Item>([
  [
    3089,
    {
      id: 3089,
      name: "Rabadon's Deathcap",
      description: "Greatly increases AP",
      plaintext: "",
      gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
      tags: [],
      stats: {},
      image: "",
      mode: "standard",
    },
  ],
  [
    3157,
    {
      id: 3157,
      name: "Zhonya's Hourglass",
      description: "Stasis active",
      plaintext: "",
      gold: { base: 650, total: 3250, sell: 2275, purchasable: true },
      tags: [],
      stats: {},
      image: "",
      mode: "standard",
    },
  ],
]);

const mockAugments = new Map<string, Augment>([
  [
    "typhoon",
    {
      name: "Typhoon",
      description: "Storms around you",
      tier: "Gold",
      sets: [],
      mode: "mayhem",
    },
  ],
  [
    "quantum computing",
    {
      name: "Quantum Computing",
      description: "Reduces cooldowns",
      tier: "Prismatic",
      sets: [],
      mode: "mayhem",
    },
  ],
]);

describe("buildEntityDictionary", () => {
  const dict = buildEntityDictionary(mockChampions, mockItems, mockAugments);

  it("includes all entity names", () => {
    expect(dict.allNames).toHaveLength(6);
    expect(dict.champions).toHaveLength(2);
    expect(dict.items).toHaveLength(2);
    expect(dict.augments).toHaveLength(2);
  });

  it("contains correct champion names", () => {
    expect(dict.champions).toContain("Aurelion Sol");
    expect(dict.champions).toContain("Miss Fortune");
  });

  it("contains correct item names", () => {
    expect(dict.items).toContain("Rabadon's Deathcap");
    expect(dict.items).toContain("Zhonya's Hourglass");
  });

  it("contains correct augment names", () => {
    expect(dict.augments).toContain("Typhoon");
    expect(dict.augments).toContain("Quantum Computing");
  });

  it("finds exact matches with highest score", () => {
    const results = dict.search("Typhoon");
    expect(results[0].name).toBe("Typhoon");
    expect(results[0].type).toBe("augment");
    expect(results[0].score).toBe(1);
  });

  it("finds case-insensitive matches", () => {
    const results = dict.search("typhoon");
    expect(results[0].name).toBe("Typhoon");
  });

  it("finds partial matches", () => {
    const results = dict.search("aurelion");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Aurelion Sol");
    expect(results[0].type).toBe("champion");
  });

  it("finds fuzzy matches with typos", () => {
    const results = dict.search("rabadons");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Rabadon's Deathcap");
  });

  it("returns empty array for nonsense queries", () => {
    const results = dict.search("xyzxyzxyz");
    expect(results).toHaveLength(0);
  });

  it("returns results sorted by score descending", () => {
    const results = dict.search("miss");
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });
});
