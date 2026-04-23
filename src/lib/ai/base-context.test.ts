import { describe, it, expect } from "vitest";
import { buildBaseContext } from "./base-context";
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

describe("buildBaseContext", () => {
  it("includes persona, response rules, and state-snapshot format explainer", () => {
    const context = buildBaseContext({
      mode: createStubMode(),
      gameData: createStubGameData(),
      gameState: createGameState(),
    });

    expect(context).toContain("expert League of Legends coaching AI");
    expect(context).toContain("ITEM AWARENESS");
    expect(context).toContain("GOLD AWARENESS");
    expect(context).toContain("[Game State]");
    // Voice/tone rules moved to `briefPersonality` (Phase 6) so new
    // personalities replace them cleanly instead of fighting embedded
    // brevity instructions in the base context.
    expect(context).not.toContain("RESPONSE RULES");
    expect(context).not.toContain("1-3 sentences");
  });

  it("includes game mode display name, champion profile, runes, and roster", () => {
    const mode = createStubMode({ displayName: "ARAM Mayhem" });
    const context = buildBaseContext({
      mode,
      gameData: createStubGameData(),
      gameState: createGameState(),
    });

    expect(context).toContain("GAME MODE: ARAM Mayhem");
    expect(context).toContain("Ahri — the Nine-Tailed Fox");
    expect(context).toContain("Essence Theft");
    expect(context).toContain("Electrocute (Domination / Sorcery)");
    expect(context).toContain("Match Roster");
    expect(context).toContain("Ahri (Mage/Assassin)");
    expect(context).toContain("Zed (Assassin)");
  });

  it("does NOT include feature-specific rule blocks", () => {
    const mode = createStubMode({
      decisionTypes: [
        "augment-selection",
        "item-purchase",
        "open-ended-coaching",
      ],
    });
    const context = buildBaseContext({
      mode,
      gameData: createStubGameData(),
      gameState: createGameState(),
    });

    expect(context).not.toContain("ITEM RECOMMENDATIONS:");
    expect(context).not.toContain("PROACTIVE AWARENESS");
    expect(context).not.toContain("ITEM POOL USAGE");
    expect(context).not.toContain("AUGMENT FIT RATING");
    expect(context).not.toContain("SYNERGY COACHING");
  });

  it("does not include ephemeral stats (gold, KDA, level) — those live in state snapshots", () => {
    const context = buildBaseContext({
      mode: createStubMode(),
      gameData: createStubGameData(),
      gameState: createGameState(),
    });

    expect(context).not.toContain("Gold:");
    expect(context).not.toContain("KDA:");
    expect(context).not.toContain("Level 10");
  });
});
