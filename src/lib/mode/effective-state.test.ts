import { describe, it, expect } from "vitest";
import { buildEffectiveGameState } from "./effective-state";
import type { GameState } from "../game-state/types";
import type { ModeContext, PlayerModeContext, GameMode } from "./types";

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
        position: "MIDDLE",
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
        riotIdGameName: "Player2",
        position: "TOP",
        isActivePlayer: false,
      },
      {
        championName: "Vayne",
        team: "CHAOS",
        level: 11,
        kills: 8,
        deaths: 1,
        assists: 3,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Enemy1",
        position: "BOTTOM",
        isActivePlayer: false,
      },
    ],
    gameMode: "ARAM",
    gameTime: 600,
    ...overrides,
  };
}

const stubMode: GameMode = {
  id: "test",
  displayName: "Test",
  decisionTypes: [],
  matches: () => true,
  buildContext: () => ({}) as ModeContext,
};

function createModeContext(): ModeContext {
  const allyCtx: PlayerModeContext = {
    championName: "Ahri",
    team: "ORDER",
    tags: ["Mage", "Assassin"],
    balanceOverrides: { dmgDealt: 1.0, dmgTaken: 0.95 },
    selectedAugments: [],
    setProgress: [],
  };
  const ally2Ctx: PlayerModeContext = {
    championName: "Garen",
    team: "ORDER",
    tags: ["Fighter", "Tank"],
    balanceOverrides: { dmgDealt: 1.05, dmgTaken: 1.05 },
    selectedAugments: [],
    setProgress: [],
  };
  const enemyCtx: PlayerModeContext = {
    championName: "Vayne",
    team: "CHAOS",
    tags: ["Marksman", "Assassin"],
    balanceOverrides: { dmgDealt: 0.95, dmgTaken: 1.05 },
    selectedAugments: [],
    setProgress: [],
  };

  return {
    mode: stubMode,
    playerContexts: new Map([
      ["Player1", allyCtx],
      ["Player2", ally2Ctx],
      ["Enemy1", enemyCtx],
    ]),
    modeItems: new Map(),
    modeAugments: new Map(),
    augmentSets: [],
    allyTeamComp: { players: [allyCtx, ally2Ctx], classCounts: {} },
    enemyTeamComp: { players: [enemyCtx], classCounts: {} },
  };
}

describe("buildEffectiveGameState", () => {
  it("passes through status, gameMode, and gameTime", () => {
    const eff = buildEffectiveGameState(createGameState(), null);
    expect(eff.status).toBe("connected");
    expect(eff.gameMode).toBe("ARAM");
    expect(eff.gameTime).toBe(600);
  });

  it("preserves raw game state reference", () => {
    const gs = createGameState();
    const eff = buildEffectiveGameState(gs, null);
    expect(eff.raw).toBe(gs);
  });

  it("splits players into allies and enemies based on active player team", () => {
    const eff = buildEffectiveGameState(createGameState(), null);
    expect(eff.allies).toHaveLength(2);
    expect(eff.enemies).toHaveLength(1);
    expect(
      eff.allies.every(
        (p) => p.championName === "Ahri" || p.championName === "Garen"
      )
    ).toBe(true);
    expect(eff.enemies[0].championName).toBe("Vayne");
  });

  it("builds active player with gold, runes, and stats", () => {
    const eff = buildEffectiveGameState(createGameState(), null);
    expect(eff.activePlayer).not.toBeNull();
    expect(eff.activePlayer!.championName).toBe("Ahri");
    expect(eff.activePlayer!.currentGold).toBe(2500);
    expect(eff.activePlayer!.runes?.keystone).toBe("Electrocute");
    expect(eff.activePlayer!.stats?.abilityPower).toBe(200);
  });

  it("returns null active player when game state has none", () => {
    const gs = createGameState({ activePlayer: null });
    const eff = buildEffectiveGameState(gs, null);
    expect(eff.activePlayer).toBeNull();
  });

  it("works without mode context (null)", () => {
    const eff = buildEffectiveGameState(createGameState(), null);
    expect(eff.modeContext).toBeNull();
    // Players should still have empty tags and null overrides
    expect(eff.activePlayer!.tags).toEqual([]);
    expect(eff.activePlayer!.balanceOverrides).toBeNull();
  });

  it("enriches players with mode context data", () => {
    const eff = buildEffectiveGameState(createGameState(), createModeContext());
    expect(eff.activePlayer!.tags).toEqual(["Mage", "Assassin"]);
    expect(eff.activePlayer!.balanceOverrides).toEqual({
      dmgDealt: 1.0,
      dmgTaken: 0.95,
    });
  });

  it("enriches non-active players with mode context", () => {
    const eff = buildEffectiveGameState(createGameState(), createModeContext());
    const vayne = eff.enemies.find((p) => p.championName === "Vayne");
    expect(vayne!.tags).toEqual(["Marksman", "Assassin"]);
    expect(vayne!.balanceOverrides).toEqual({
      dmgDealt: 0.95,
      dmgTaken: 1.05,
    });
  });

  it("includes selected augments and set progress on active player", () => {
    const modeCtx = createModeContext();
    const playerCtx = modeCtx.playerContexts.get("Player1")!;
    playerCtx.selectedAugments = [
      {
        name: "Typhoon",
        description: "Storm",
        tier: "Silver",
        sets: ["Firecracker"],
        mode: "mayhem",
      },
    ];
    playerCtx.setProgress = [
      {
        set: { name: "Firecracker", bonuses: [] },
        count: 1,
        nextBonus: { threshold: 2, description: "Bounce" },
      },
    ];

    const eff = buildEffectiveGameState(createGameState(), modeCtx);
    expect(eff.activePlayer!.selectedAugments).toHaveLength(1);
    expect(eff.activePlayer!.setProgress).toHaveLength(1);
  });

  it("handles disconnected state gracefully", () => {
    const gs = createGameState({
      status: "disconnected",
      activePlayer: null,
      players: [],
      gameMode: "",
      gameTime: 0,
    });
    const eff = buildEffectiveGameState(gs, null);
    expect(eff.status).toBe("disconnected");
    expect(eff.activePlayer).toBeNull();
    expect(eff.allies).toEqual([]);
    expect(eff.enemies).toEqual([]);
  });
});
