import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildGameSystemPrompt,
} from "./prompts";
import type { CoachingContext, CoachingQuery } from "./types";
import type { GameMode, ModeContext } from "../mode/types";
import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion } from "../data-ingest/types";

function createContext(
  overrides: Partial<CoachingContext> = {}
): CoachingContext {
  return {
    champion: {
      name: "Ahri",
      level: 10,
      abilities: "Passive: Essence Theft. Q: Orb of Deception.",
      statProfile:
        "Ranged (550) | Mage, Assassin | HP: 590 (+96/lvl) | AD: 53 (+3/lvl) | AS: 0.668 (+2%/lvl) | Armor: 23 (+4.7/lvl) | MR: 30 (+1.3/lvl) | Mana",
    },
    currentGold: 2500,
    kda: { kills: 5, deaths: 2, assists: 8 },
    currentItems: [
      {
        name: "Rabadon's Deathcap",
        description: "Massively increases Ability Power.",
      },
      {
        name: "Sorcerer's Shoes",
        description: "Enhances Movement Speed and Magic Penetration.",
      },
    ],
    currentAugments: [
      {
        name: "Jeweled Gauntlet",
        description: "Your abilities can critically strike.",
      },
    ],
    teamAnalysis:
      "Your team roles: 1 Mage, 1 Assassin, 1 Fighter, 1 Tank — no Marksman, no Support. Enemy damage: heavily AD (2 AD, 1 AP — favor armor).",
    augmentSets: [],
    enemyTeam: [
      {
        champion: "Vayne",
        items: [
          {
            name: "Blade of the Ruined King",
            description: "Deals damage based on target health.",
          },
        ],
      },
      {
        champion: "Sona",
        items: [
          {
            name: "Ardent Censer",
            description: "Shields and heals empower attacks.",
          },
        ],
      },
    ],
    allyTeam: [{ champion: "Garen" }],
    gameMode: "ARAM",
    lcuGameMode: "KIWI",
    gameTime: 600,
    balanceOverrides: "Damage taken: -5%",
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("contains coaching personality", () => {
    const prompt = buildSystemPrompt({
      gameMode: "CLASSIC",
      lcuGameMode: "CLASSIC",
    });
    expect(prompt.toLowerCase()).toContain("coach");
  });

  it("establishes concise tone", () => {
    const prompt = buildSystemPrompt({
      gameMode: "CLASSIC",
      lcuGameMode: "CLASSIC",
    }).toLowerCase();
    expect(prompt).toMatch(/concise|concision/);
  });

  it("includes augment rules only when augment options are present", () => {
    const prompt = buildSystemPrompt({
      gameMode: "ARAM",
      lcuGameMode: "KIWI",
      hasAugmentOptions: true,
    }).toLowerCase();
    expect(prompt).toContain("augment");
    expect(prompt).toContain("re-roll");
    expect(prompt).toContain("not items");
  });

  it("excludes augment rules when no augment options even in Mayhem", () => {
    const prompt = buildSystemPrompt({
      gameMode: "ARAM",
      lcuGameMode: "KIWI",
      hasAugmentOptions: false,
    }).toLowerCase();
    expect(prompt).not.toContain("re-roll");
  });

  it("excludes augment rules for non-ARAM modes", () => {
    const prompt = buildSystemPrompt({
      gameMode: "CLASSIC",
      lcuGameMode: "CLASSIC",
      hasAugmentOptions: true,
    }).toLowerCase();
    expect(prompt).not.toContain("re-roll");
  });
});

describe("buildUserPrompt", () => {
  describe("with a general question", () => {
    const generalQuery: CoachingQuery = {
      question: "What should I build next?",
    };

    it("includes champion name and level", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Ahri");
      expect(prompt).toContain("10");
    });

    it("includes the question", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("What should I build next?");
    });

    it("includes enemy team", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Vayne");
      expect(prompt).toContain("Sona");
    });

    it("includes current item names near the question", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Rabadon's Deathcap");
      // Items should appear near the question, not as a separate section
      expect(prompt).toContain("Items you own:");
    });

    it("includes current gold as a whole number", () => {
      const ctx = createContext({ currentGold: 712.17431640625 });
      const prompt = buildUserPrompt(ctx, generalQuery);
      expect(prompt).toContain("712 gold available");
      expect(prompt).not.toContain("712.17");
    });

    it("includes KDA in champion header", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("5/2/8");
    });

    it("includes enemy items as names only", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Blade of the Ruined King");
    });

    it("includes current augments with descriptions", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Jeweled Gauntlet");
      expect(prompt).toContain("Your abilities can critically strike.");
    });

    it("includes game mode", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("ARAM");
    });

    it("includes balance overrides when present", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Damage taken: -5%");
    });

    it("includes champion abilities", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Orb of Deception");
    });

    it("excludes 'I chose' confirmation exchanges from history", () => {
      const query: CoachingQuery = {
        question: "What should I build?",
        history: [
          {
            question: "Goliath, Deft, or Escape Plan?",
            answer: "Take Deft.",
          },
          {
            question: "I chose Deft.",
            answer: "Good. Lock it in.",
          },
          {
            question: "What items next?",
            answer: "Build Kraken Slayer.",
          },
        ],
      };
      const prompt = buildUserPrompt(createContext(), query);
      expect(prompt).toContain("Take Deft");
      expect(prompt).toContain("Build Kraken Slayer");
      expect(prompt).not.toContain("I chose Deft");
      expect(prompt).not.toContain("Good. Lock it in");
    });

    it("includes champion stat profile when present", () => {
      const ctx = createContext({
        champion: {
          name: "Bel'Veth",
          level: 6,
          abilities: "Passive: Death in Lavender.",
          statProfile:
            "Melee | Fighter | HP: 610 (+104/lvl) | AD: 60 (+1.5/lvl) | AS: 0.85 (+3.5%/lvl) | Armor: 32 (+4.7/lvl) | MR: 32 (+2.05/lvl) | Mana",
        },
      });
      const prompt = buildUserPrompt(ctx, generalQuery);
      expect(prompt).toContain("Melee");
      expect(prompt).toContain("Fighter");
      expect(prompt).toContain("+104/lvl");
    });

    it("includes ally team", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Garen");
    });

    it("includes team analysis when present", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Team Analysis");
      expect(prompt).toContain("no Marksman");
      expect(prompt).toContain("favor armor");
    });

    it("does not include augment options section when none provided", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).not.toContain("## Augment Options");
    });
  });

  describe("with an augment selection question", () => {
    const augmentQuery: CoachingQuery = {
      question: "Which augment should I pick?",
      augmentOptions: [
        {
          name: "Jeweled Gauntlet",
          description: "Your abilities can critically strike.",
          tier: "Gold",
          sets: ["Arcana"],
        },
        {
          name: "Blade Waltz",
          description: "Dash on kill or assist.",
          tier: "Silver",
        },
      ],
    };

    it("includes augment options with descriptions", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("Jeweled Gauntlet");
      expect(prompt).toContain("Your abilities can critically strike");
      expect(prompt).toContain("Blade Waltz");
    });

    it("includes augment tiers", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("Gold");
      expect(prompt).toContain("Silver");
    });

    it("includes set information for augments that have it", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("Arcana");
    });

    it("includes the augment options section heading", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("## Augment Options");
    });

    it("annotates offered augments with set bonus progress", () => {
      const ctx = createContext({
        currentAugments: [
          {
            name: "Snowball Upgrade",
            description: "Mark deals bonus true damage on arrival.",
            sets: ["Snowday"],
          },
        ],
        augmentSets: [
          {
            name: "Snowday",
            bonuses: [
              {
                threshold: 2,
                description:
                  "Mark deals 30% increased damage, 50 summoner spell haste",
              },
            ],
          },
        ],
      });
      const query: CoachingQuery = {
        question: "Which augment?",
        augmentOptions: [
          {
            name: "Biggest Snowball Ever",
            description: "Mark grows as it travels.",
            tier: "Silver",
            sets: ["Snowday"],
          },
          {
            name: "Blunt Force",
            description: "Increases attack damage by 20%.",
            tier: "Silver",
          },
        ],
      };

      const prompt = buildUserPrompt(ctx, query);
      // Should indicate picking Biggest Snowball Ever completes the 2-piece bonus
      expect(prompt).toContain("Snowday");
      expect(prompt).toContain("2/2");
      expect(prompt).toContain("Mark deals 30% increased damage");
    });
  });

  describe("with augment set progress", () => {
    it("shows set progress when player has augments in a set", () => {
      const ctx = createContext({
        currentAugments: [
          {
            name: "Snowball Upgrade",
            description: "Mark deals bonus true damage on arrival.",
            sets: ["Snowday"],
          },
          {
            name: "Biggest Snowball Ever",
            description: "Mark grows as it travels.",
            sets: ["Snowday"],
          },
        ],
        augmentSets: [
          {
            name: "Snowday",
            bonuses: [
              {
                threshold: 2,
                description:
                  "Mark deals 30% increased damage, 50 summoner spell haste",
              },
              {
                threshold: 3,
                description:
                  "Mark deals 50% increased damage, 100 summoner spell haste",
              },
            ],
          },
        ],
      });

      const prompt = buildUserPrompt(ctx, { question: "What should I do?" });
      // Should show active bonus and next threshold
      expect(prompt).toContain("Snowday");
      expect(prompt).toContain("2/3");
      expect(prompt).toContain("Mark deals 30% increased damage");
    });

    it("does not show set progress section when no sets are active", () => {
      const ctx = createContext({
        currentAugments: [
          {
            name: "Blunt Force",
            description: "Increases attack damage by 20%.",
          },
        ],
        augmentSets: [
          {
            name: "Snowday",
            bonuses: [
              { threshold: 2, description: "Mark deals 30% increased damage" },
            ],
          },
        ],
      });

      const prompt = buildUserPrompt(ctx, { question: "What should I do?" });
      expect(prompt).not.toContain("Set Progress");
    });
  });
});

// --- buildGameSystemPrompt tests ---

function createStubMode(overrides: Partial<GameMode> = {}): GameMode {
  return {
    id: "test-mode",
    displayName: "Test Mode",
    decisionTypes: ["item-purchase", "open-ended-coaching"],
    augmentSelectionLevels: [],
    matches: () => false,
    buildContext: () => ({}) as ModeContext,
    ...overrides,
  };
}

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
        items: [],
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
        items: [],
        summonerSpells: ["Flash", "Ignite"],
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

function createStubGameData(): LoadedGameData {
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
        aramOverrides: { dmgDealt: 0.95, dmgTaken: 1.05 },
        abilities: {
          passive: {
            name: "Essence Theft",
            description: "Ahri heals when hitting enemies with abilities.",
          },
          spells: [
            {
              id: "AhriQ",
              name: "Orb of Deception",
              description: "Throws and pulls back an orb.",
              maxRank: 5,
              cooldowns: [7, 7, 7, 7, 7],
              costs: [60, 70, 80, 90, 100],
              range: [880, 880, 880, 880, 880],
            },
          ],
        },
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
      },
    ],
    [
      "zed",
      {
        id: "Zed",
        key: 238,
        name: "Zed",
        title: "the Master of Shadows",
        tags: ["Assassin"],
        partype: "Energy",
        stats: {} as Champion["stats"],
        image: "",
      },
    ],
  ]);

  return {
    version: "16.6.1",
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

describe("buildGameSystemPrompt", () => {
  it("includes coaching persona and rules", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("expert League of Legends coaching AI");
    expect(prompt).toContain("ITEM AWARENESS");
    expect(prompt).toContain("GOLD AWARENESS");
    expect(prompt).toContain("RESPONSE RULES");
  });

  it("includes state snapshot format instructions", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("[Game State]");
  });

  it("includes proactive awareness instruction", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("PROACTIVE AWARENESS");
  });

  it("includes augment rules when mode has augment-selection", () => {
    const mode = createStubMode({
      decisionTypes: [
        "augment-selection",
        "item-purchase",
        "open-ended-coaching",
      ],
    });
    const prompt = buildGameSystemPrompt(
      mode,
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("AUGMENT SELECTION RULES");
    expect(prompt).toContain("re-roll");
  });

  it("excludes augment rules when mode lacks augment-selection", () => {
    const mode = createStubMode({
      decisionTypes: ["item-purchase", "open-ended-coaching"],
    });
    const prompt = buildGameSystemPrompt(
      mode,
      createStubGameData(),
      createGameState()
    );
    expect(prompt).not.toContain("AUGMENT SELECTION RULES");
  });

  it("includes game mode display name", () => {
    const mode = createStubMode({ displayName: "ARAM Mayhem" });
    const prompt = buildGameSystemPrompt(
      mode,
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("GAME MODE: ARAM Mayhem");
  });

  it("includes player champion name and abilities", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("Ahri");
    expect(prompt).toContain("the Nine-Tailed Fox");
    expect(prompt).toContain("Essence Theft");
    expect(prompt).toContain("Orb of Deception");
  });

  it("includes champion tags and range type", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("Ranged (550)");
    expect(prompt).toContain("Mage, Assassin");
  });

  it("includes rune setup", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("Electrocute (Domination / Sorcery)");
  });

  it("includes balance overrides for ARAM-family modes", () => {
    const aramMode = createStubMode({
      matches: (gm) => gm === "ARAM",
    });
    const prompt = buildGameSystemPrompt(
      aramMode,
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("Balance Overrides");
    expect(prompt).toContain("Damage dealt: -5%");
    expect(prompt).toContain("Damage taken: +5%");
  });

  it("excludes balance overrides for non-ARAM modes", () => {
    const classicMode = createStubMode({
      matches: () => false,
    });
    const prompt = buildGameSystemPrompt(
      classicMode,
      createStubGameData(),
      createGameState()
    );
    expect(prompt).not.toContain("Balance Overrides");
  });

  it("includes all champions with tags in match roster", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("Match Roster");
    expect(prompt).toContain("Ahri (Mage/Assassin)");
    expect(prompt).toContain("Garen (Fighter/Tank)");
    expect(prompt).toContain("Zed (Assassin)");
  });

  it("separates ally and enemy teams in roster", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("Ally Team:");
    expect(prompt).toContain("Enemy Team:");
  });

  it("does not include gold, items, level, or KDA", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    // These are dynamic and belong in state snapshots, not system prompt
    expect(prompt).not.toContain("Gold:");
    expect(prompt).not.toContain("KDA:");
    expect(prompt).not.toContain("Level 10");
  });
});
