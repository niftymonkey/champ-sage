import { describe, it, expect } from "vitest";
import { assembleContext } from "./context-assembler";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion, Item } from "../data-ingest/types";

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
    lcuGameMode: "KIWI",
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
    stats: {
      hp: 590,
      hpperlevel: 96,
      mp: 418,
      mpperlevel: 25,
      movespeed: 330,
      armor: 23,
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

  const garen: Champion = {
    id: "Garen",
    key: 86,
    name: "Garen",
    title: "the Might of Demacia",
    tags: ["Fighter", "Tank"],
    partype: "None",
    stats: {
      hp: 690,
      hpperlevel: 98,
      mp: 0,
      mpperlevel: 0,
      movespeed: 340,
      armor: 38,
      armorperlevel: 4.2,
      spellblock: 32,
      spellblockperlevel: 1.55,
      attackrange: 175,
      hpregen: 8,
      hpregenperlevel: 0.5,
      mpregen: 0,
      mpregenperlevel: 0,
      attackdamage: 69,
      attackdamageperlevel: 4.5,
      attackspeed: 0.625,
      attackspeedperlevel: 3.65,
    },
    image: "",
  };

  const vayne: Champion = {
    id: "Vayne",
    key: 67,
    name: "Vayne",
    title: "the Night Hunter",
    tags: ["Marksman", "Assassin"],
    partype: "Mana",
    stats: {
      hp: 550,
      hpperlevel: 103,
      mp: 232,
      mpperlevel: 35,
      movespeed: 330,
      armor: 23,
      armorperlevel: 4.6,
      spellblock: 30,
      spellblockperlevel: 1.3,
      attackrange: 550,
      hpregen: 3.5,
      hpregenperlevel: 0.55,
      mpregen: 8,
      mpregenperlevel: 0.7,
      attackdamage: 60,
      attackdamageperlevel: 2.35,
      attackspeed: 0.658,
      attackspeedperlevel: 3.3,
    },
    image: "",
  };

  const champions = new Map<string, Champion>([
    ["ahri", ahri],
    ["garen", garen],
    ["vayne", vayne],
  ]);

  const items = new Map<number, Item>([
    [
      3089,
      {
        id: 3089,
        name: "Rabadon's Deathcap",
        description: "Massively increases Ability Power.",
        plaintext: "Massively increases Ability Power",
        gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
        tags: [],
        stats: {},
        image: "",
        mode: "standard",
      },
    ],
    [
      3075,
      {
        id: 3075,
        name: "Thornmail",
        description: "Returns damage to attackers and applies Grievous Wounds.",
        plaintext: "Returns damage on being hit",
        gold: { base: 1000, total: 2700, sell: 1890, purchasable: true },
        tags: [],
        stats: {},
        image: "",
        mode: "standard",
      },
    ],
    [
      3153,
      {
        id: 3153,
        name: "Blade of the Ruined King",
        description:
          "Deals damage based on target's max health. Steals movement speed.",
        plaintext: "Deals damage based on target health",
        gold: { base: 900, total: 3200, sell: 2240, purchasable: true },
        tags: [],
        stats: {},
        image: "",
        mode: "standard",
      },
    ],
  ]);

  return {
    version: "14.10.1",
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

  it("includes current items with descriptions from active player", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.currentItems).toEqual([
      {
        name: "Rabadon's Deathcap",
        description: "Massively increases Ability Power.",
      },
    ]);
  });

  it("falls back to empty description when item not in gameData", () => {
    const gameData = createGameData();
    gameData.items.clear();
    const result = assembleContext(createLiveGameState(), gameData);
    expect(result).not.toBeNull();
    expect(result!.currentItems).toEqual([
      { name: "Rabadon's Deathcap", description: "" },
    ]);
  });

  it("includes enemy team with item descriptions", () => {
    const result = assembleContext(createLiveGameState(), createGameData());
    expect(result).not.toBeNull();
    expect(result!.enemyTeam).toHaveLength(1);
    expect(result!.enemyTeam[0].champion).toBe("Vayne");
    expect(result!.enemyTeam[0].items).toEqual([
      {
        name: "Blade of the Ruined King",
        description:
          "Deals damage based on target's max health. Steals movement speed.",
      },
    ]);
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

  describe("champion stat profile", () => {
    it("includes range type for ranged champion", () => {
      const result = assembleContext(createLiveGameState(), createGameData());
      // Ahri has 550 attack range — ranged
      expect(result!.champion.statProfile).toContain("Ranged");
    });

    it("includes DDragon tags", () => {
      const result = assembleContext(createLiveGameState(), createGameData());
      expect(result!.champion.statProfile).toContain("Mage");
      expect(result!.champion.statProfile).toContain("Assassin");
    });

    it("includes key base stats and growth rates", () => {
      const result = assembleContext(createLiveGameState(), createGameData());
      const profile = result!.champion.statProfile!;
      // Should include HP and HP/level
      expect(profile).toContain("590");
      expect(profile).toContain("96");
      // Should include AD info
      expect(profile).toContain("53");
    });

    it("includes melee for low attack range champion", () => {
      const gameData = createGameData();
      const ahri = gameData.champions.get("ahri")!;
      ahri.stats.attackrange = 125;
      ahri.tags = ["Fighter"];

      const result = assembleContext(createLiveGameState(), gameData);
      expect(result!.champion.statProfile).toContain("Melee");
    });

    it("returns null when champion data is not found", () => {
      const gameState = createLiveGameState({
        activePlayer: {
          ...createLiveGameState().activePlayer!,
          championName: "UnknownChamp",
        },
        players: [
          {
            ...createLiveGameState().players[0],
            championName: "UnknownChamp",
          },
          ...createLiveGameState().players.slice(1),
        ],
      });

      const result = assembleContext(gameState, createGameData());
      expect(result).not.toBeNull();
      expect(result!.champion.statProfile).toBeNull();
    });
  });

  describe("team analysis", () => {
    it("includes ally team role breakdown without player count", () => {
      const result = assembleContext(createLiveGameState(), createGameData());
      // Ally team has Ahri (Mage, Assassin) + Garen (Fighter, Tank)
      expect(result!.teamAnalysis).toContain("Fighter");
      expect(result!.teamAnalysis).toContain("Tank");
      expect(result!.teamAnalysis).toContain("Mage");
      // Should say "Your team roles:" not "Your team (2 players):"
      expect(result!.teamAnalysis).toContain("Your team roles:");
      expect(result!.teamAnalysis).not.toContain("players");
    });

    it("shows missing roles as gaps", () => {
      const result = assembleContext(createLiveGameState(), createGameData());
      // Team has Mage, Assassin, Fighter, Tank — missing Marksman and Support
      expect(result!.teamAnalysis).toContain("no Marksman");
      expect(result!.teamAnalysis).toContain("Support");
    });

    it("classifies enemy damage profile with resistance guidance", () => {
      const result = assembleContext(createLiveGameState(), createGameData());
      // Enemy has Vayne (Marksman, Assassin) — only AD, no AP
      // With 1 enemy who is AD only, should say "all AD" + "stack armor"
      expect(result!.teamAnalysis).toContain("AD");
      expect(result!.teamAnalysis).toContain("armor");
    });

    it("returns null when no champion data is available for team members", () => {
      const gameData = createGameData();
      gameData.champions.clear();

      const result = assembleContext(createLiveGameState(), gameData);
      expect(result!.teamAnalysis).toBeNull();
    });
  });
});
