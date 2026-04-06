import { describe, it, expect } from "vitest";
import {
  formatStateSnapshot,
  takeGameSnapshot,
  type GameSnapshot,
} from "./state-formatter";
import type { ActivePlayerStats } from "../game-state/types";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { Item, Augment, AugmentSet } from "../data-ingest/types";
import type { ComputedStats } from "./enemy-stats";

function createPlayerStats(): ActivePlayerStats {
  return {
    abilityPower: 200,
    attackDamage: 80,
    attackSpeed: 0.8,
    armor: 60,
    magicResist: 40,
    abilityHaste: 30,
    critChance: 0,
    moveSpeed: 350,
    maxHealth: 1800,
    currentHealth: 1500,
  };
}

function createSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    player: {
      championName: "Ahri",
      level: 10,
      kda: { kills: 5, deaths: 2, assists: 8 },
      items: [
        {
          name: "Rabadon's Deathcap",
          description: "Greatly increases Ability Power",
        },
        { name: "Zhonya's Hourglass", description: "" },
      ],
      gold: 1250,
      stats: createPlayerStats(),
      augments: [],
    },
    allies: ["Garen", "Lux", "Jinx"],
    enemies: [
      {
        championName: "Zed",
        level: 11,
        kda: { kills: 8, deaths: 1, assists: 3 },
        items: ["Duskblade of Draktharr", "Edge of Night"],
        stats: {
          attackDamage: 180,
          abilityPower: 0,
          armor: 75,
          magicResist: 42,
          maxHealth: 2000,
          moveSpeed: 380,
          attackSpeed: 1.1,
        },
      },
      {
        championName: "Sona",
        level: 8,
        kda: { kills: 1, deaths: 5, assists: 12 },
        items: ["Ardent Censer"],
        stats: {
          attackDamage: 55,
          abilityPower: 120,
          armor: 35,
          magicResist: 38,
          maxHealth: 1400,
          moveSpeed: 340,
          attackSpeed: 0.7,
        },
      },
    ],
    gameTime: 600,
    augmentSetProgress: [],
    ...overrides,
  };
}

describe("formatStateSnapshot", () => {
  it("includes game time", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain("Game Time: 10:00");
  });

  it("includes player champion name and level", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain("Player Champion: Ahri (Level 10)");
  });

  it("includes KDA", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain("KDA: 5/2/8");
  });

  it("includes items with descriptions when available", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain(
      "Rabadon's Deathcap (Greatly increases Ability Power)"
    );
    // Item without description shows just name
    expect(output).toContain("Zhonya's Hourglass");
    expect(output).not.toContain("Zhonya's Hourglass ()");
  });

  it("shows 'none' when player has no items", () => {
    const snapshot = createSnapshot();
    snapshot.player.items = [];
    const output = formatStateSnapshot(snapshot);
    expect(output).toContain("Items: none");
  });

  it("includes gold floored to integer", () => {
    const snapshot = createSnapshot();
    snapshot.player.gold = 1250.7;
    const output = formatStateSnapshot(snapshot);
    expect(output).toContain("Gold: 1250");
  });

  it("includes player stats from API", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain(
      "Stats: 200 AP, 80 AD, 60 Armor, 40 MR, 30 AH, 0.80 AS, 0% Crit, 350 MS, 1800 HP"
    );
  });

  it("includes augments with descriptions", () => {
    const snapshot = createSnapshot();
    snapshot.player.augments = [
      {
        name: "Jeweled Gauntlet",
        description: "Your abilities can critically strike.",
        sets: [],
      },
      { name: "Ethereal Blades", description: "", sets: [] },
    ];
    const output = formatStateSnapshot(snapshot);
    expect(output).toContain(
      "- Jeweled Gauntlet: Your abilities can critically strike."
    );
    expect(output).toContain("- Ethereal Blades");
  });

  it("omits augments section when empty", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).not.toContain("Augments:");
  });

  it("includes set progress when augments have sets", () => {
    const snapshot = createSnapshot({
      augmentSetProgress: [
        {
          name: "Snowday",
          count: 2,
          nextThreshold: 3,
          activeBonus: "Mark deals 30% increased damage",
          nextBonus: "Mark deals 50% increased damage",
        },
      ],
    });
    const output = formatStateSnapshot(snapshot);
    expect(output).toContain("Set Progress:");
    expect(output).toContain(
      "- Snowday (2/3) — Active: Mark deals 30% increased damage — Next at 3: Mark deals 50% increased damage"
    );
  });

  it("omits set progress when empty", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).not.toContain("Set Progress:");
  });

  it("includes ally team", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain("Ally Team: Garen, Lux, Jinx");
  });

  it("includes enemy team with stats and items", () => {
    const output = formatStateSnapshot(createSnapshot());
    expect(output).toContain("Enemy Team:");
    expect(output).toContain(
      "- Zed (Level 11, 8/1/3): 180 AD, 0 AP, 75 Armor, 42 MR, 1.10 AS, 380 MS, 2000 HP — Duskblade of Draktharr, Edge of Night"
    );
    expect(output).toContain(
      "- Sona (Level 8, 1/5/12): 55 AD, 120 AP, 35 Armor, 38 MR, 0.70 AS, 340 MS, 1400 HP — Ardent Censer"
    );
  });

  it("shows 'no items' for enemies without items", () => {
    const snapshot = createSnapshot();
    snapshot.enemies[0].items = [];
    const output = formatStateSnapshot(snapshot);
    expect(output).toContain("no items");
  });

  it("formats enemy without computed stats gracefully", () => {
    const snapshot = createSnapshot();
    snapshot.enemies[0].stats = null;
    const output = formatStateSnapshot(snapshot);
    expect(output).toContain(
      "- Zed (Level 11, 8/1/3): Duskblade of Draktharr, Edge of Night"
    );
  });
});

describe("takeGameSnapshot", () => {
  function createLiveGameState(): LiveGameState {
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
        stats: createPlayerStats(),
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
          items: [],
          summonerSpells: ["Flash", "Mark"],
          riotIdGameName: "Ally1",
          position: "",
          isActivePlayer: false,
        },
        {
          championName: "Zed",
          team: "CHAOS",
          level: 11,
          kills: 8,
          deaths: 1,
          assists: 3,
          items: [{ id: 6693, name: "Duskblade of Draktharr" }],
          summonerSpells: ["Flash", "Ignite"],
          riotIdGameName: "Enemy1",
          position: "",
          isActivePlayer: false,
        },
      ],
      gameMode: "ARAM",
      lcuGameMode: "ARAM",
      gameTime: 600,
      champSelect: null,
      eogStats: null,
    };
  }

  function createGameData(overrides?: {
    augments?: Map<string, Augment>;
    augmentSets?: AugmentSet[];
  }): LoadedGameData {
    const items = new Map<number, Item>([
      [
        3089,
        {
          id: 3089,
          name: "Rabadon's Deathcap",
          description: "<stats>AP</stats>",
          plaintext: "Greatly increases Ability Power",
          gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
          tags: [],
          stats: {},
          image: "",
          mode: "standard",
        },
      ],
    ]);

    return {
      version: "16.6.1",
      champions: new Map(),
      items,
      runes: [],
      augments: overrides?.augments ?? new Map(),
      augmentSets: overrides?.augmentSets ?? [],
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

  it("returns null when no active player", () => {
    const state = createLiveGameState();
    state.activePlayer = null;
    const snapshot = takeGameSnapshot(state, new Map(), createGameData());
    expect(snapshot).toBeNull();
  });

  it("builds player snapshot from active player", () => {
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData()
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot!.player.championName).toBe("Ahri");
    expect(snapshot!.player.level).toBe(10);
    expect(snapshot!.player.gold).toBe(2500);
    expect(snapshot!.player.kda).toEqual({ kills: 5, deaths: 2, assists: 8 });
  });

  it("uses plaintext for item descriptions", () => {
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData()
    );
    expect(snapshot!.player.items[0].description).toBe(
      "Greatly increases Ability Power"
    );
  });

  it("separates allies and enemies by team", () => {
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData()
    );
    expect(snapshot!.allies).toEqual(["Garen"]);
    expect(snapshot!.enemies).toHaveLength(1);
    expect(snapshot!.enemies[0].championName).toBe("Zed");
  });

  it("includes computed enemy stats when available", () => {
    const enemyStats = new Map<string, ComputedStats>([
      [
        "Zed",
        {
          attackDamage: 180,
          abilityPower: 0,
          armor: 75,
          magicResist: 42,
          maxHealth: 2000,
          moveSpeed: 380,
          attackSpeed: 1.1,
        },
      ],
    ]);
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      enemyStats,
      createGameData()
    );
    expect(snapshot!.enemies[0].stats).not.toBeNull();
    expect(snapshot!.enemies[0].stats!.attackDamage).toBe(180);
  });

  it("sets null stats for enemies without computed stats", () => {
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData()
    );
    expect(snapshot!.enemies[0].stats).toBeNull();
  });

  it("resolves augment descriptions and sets from game data", () => {
    const augments = new Map<string, Augment>([
      [
        "jeweled gauntlet",
        {
          name: "Jeweled Gauntlet",
          description: "Your abilities can critically strike.",
          tier: "Gold",
          sets: ["Arcana"],
          mode: "mayhem",
        },
      ],
    ]);
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData({ augments }),
      ["Jeweled Gauntlet"]
    );
    expect(snapshot!.player.augments).toEqual([
      {
        name: "Jeweled Gauntlet",
        description: "Your abilities can critically strike.",
        sets: ["Arcana"],
      },
    ]);
  });

  it("handles augments not found in game data", () => {
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData(),
      ["Unknown Augment"]
    );
    expect(snapshot!.player.augments).toEqual([
      { name: "Unknown Augment", description: "", sets: [] },
    ]);
  });

  it("computes set progress from augment data", () => {
    const augments = new Map<string, Augment>([
      [
        "snowball upgrade",
        {
          name: "Snowball Upgrade",
          description: "Mark deals bonus damage.",
          tier: "Silver",
          sets: ["Snowday"],
          mode: "mayhem",
        },
      ],
      [
        "biggest snowball ever",
        {
          name: "Biggest Snowball Ever",
          description: "Mark grows as it travels.",
          tier: "Silver",
          sets: ["Snowday"],
          mode: "mayhem",
        },
      ],
    ]);
    const augmentSets: AugmentSet[] = [
      {
        name: "Snowday",
        bonuses: [
          { threshold: 2, description: "Mark deals 30% increased damage" },
          { threshold: 3, description: "Mark deals 50% increased damage" },
        ],
      },
    ];
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData({ augments, augmentSets }),
      ["Snowball Upgrade", "Biggest Snowball Ever"]
    );
    expect(snapshot!.augmentSetProgress).toEqual([
      {
        name: "Snowday",
        count: 2,
        nextThreshold: 3,
        activeBonus: "Mark deals 30% increased damage",
        nextBonus: "Mark deals 50% increased damage",
      },
    ]);
  });

  it("returns empty set progress when no augments have sets", () => {
    const snapshot = takeGameSnapshot(
      createLiveGameState(),
      new Map(),
      createGameData(),
      ["Some Augment"]
    );
    expect(snapshot!.augmentSetProgress).toEqual([]);
  });
});
