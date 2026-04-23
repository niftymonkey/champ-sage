import { describe, it, expect } from "vitest";
import { buildGameSystemPrompt } from "./prompts";
import type { GameMode, ModeContext } from "../mode/types";
import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion } from "../data-ingest/types";

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
  });

  it("no longer carries brevity rules (moved to briefPersonality in Phase 6)", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    // RESPONSE RULES and the 1-3 sentences ceiling now live in
    // `briefPersonality.suffix()` and are applied by session.ask at
    // runtime, not by this compat shim.
    expect(prompt).not.toContain("RESPONSE RULES");
    expect(prompt).not.toContain("1-3 sentences");
  });

  it("includes directive state awareness instruction with specific champions", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("enemy team composition");
    expect(prompt).toContain("grievous wounds");
    expect(prompt).toContain("magic resist");
  });

  it("scopes item recommendation format to purchase responses", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain("When recommending an item purchase");
    expect(prompt).toContain("non-purchase responses");
  });

  it("includes gold-aware item recommendation format", () => {
    const prompt = buildGameSystemPrompt(
      createStubMode(),
      createStubGameData(),
      createGameState()
    );
    expect(prompt).toContain(
      "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now"
    );
    expect(prompt).toContain(
      "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod at 1250g"
    );
    expect(prompt).toContain(
      "most expensive component the player can currently afford"
    );
    expect(prompt).not.toContain("buy Needlessly Large Rod next (1250g)");
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

  it("includes augment fit-rating guidance when mode has augment-selection", () => {
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
    expect(prompt).toContain("AUGMENT FIT RATING");
    expect(prompt).toContain("exceptional");
    expect(prompt).toContain("independent");
    expect(prompt).not.toContain("re-roll");
  });

  it("includes synergy coaching instruction when mode has augment-selection", () => {
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
    expect(prompt).toContain("SYNERGY COACHING");
    expect(prompt).toContain("set bonus");
    expect(prompt).toContain("creative synergies");
  });

  it("excludes synergy coaching when mode lacks augment-selection", () => {
    const mode = createStubMode({
      decisionTypes: ["item-purchase", "open-ended-coaching"],
    });
    const prompt = buildGameSystemPrompt(
      mode,
      createStubGameData(),
      createGameState()
    );
    expect(prompt).not.toContain("SYNERGY COACHING");
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
    expect(prompt).not.toContain("AUGMENT FIT RATING");
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
