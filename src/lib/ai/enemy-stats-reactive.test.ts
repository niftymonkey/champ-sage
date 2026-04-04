import { describe, it, expect, afterEach } from "vitest";
import { BehaviorSubject } from "rxjs";
import { createEnemyStatsStream } from "./enemy-stats-reactive";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion, Item } from "../data-ingest/types";
import type { Subscription } from "rxjs";

let subscription: Subscription | null = null;

afterEach(() => {
  subscription?.unsubscribe();
  subscription = null;
});

function createDefaultLiveGameState(): LiveGameState {
  return {
    activePlayer: null,
    players: [],
    gameMode: "ARAM",
    lcuGameMode: "ARAM",
    gameTime: 0,
    champSelect: null,
    eogStats: null,
  };
}

function createGameData(): LoadedGameData {
  const champions = new Map<string, Champion>([
    [
      "zed",
      {
        id: "Zed",
        key: 238,
        name: "Zed",
        title: "the Master of Shadows",
        tags: ["Assassin"],
        partype: "Energy",
        stats: {
          hp: 654,
          hpperlevel: 99,
          mp: 200,
          mpperlevel: 0,
          movespeed: 345,
          armor: 32,
          armorperlevel: 4.7,
          spellblock: 32,
          spellblockperlevel: 2.05,
          attackrange: 125,
          hpregen: 7,
          hpregenperlevel: 0.65,
          mpregen: 50,
          mpregenperlevel: 0,
          attackdamage: 63,
          attackdamageperlevel: 3.4,
          attackspeed: 0.651,
          attackspeedperlevel: 3.3,
        },
        image: "",
      },
    ],
  ]);

  const items = new Map<number, Item>([
    [
      6693,
      {
        id: 6693,
        name: "Duskblade of Draktharr",
        description: "AD assassin item",
        plaintext: "Grants AD and lethality",
        gold: { base: 800, total: 2800, sell: 1960, purchasable: true },
        tags: [],
        stats: { FlatPhysicalDamageMod: 60 },
        image: "",
        mode: "standard",
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

function createActivePlayerStub() {
  return {
    championName: "Ahri",
    level: 10,
    currentGold: 0,
    runes: {
      keystone: "Electrocute",
      primaryTree: "Domination",
      secondaryTree: "Sorcery",
    },
    stats: {
      abilityPower: 0,
      armor: 0,
      attackDamage: 0,
      attackSpeed: 0,
      abilityHaste: 0,
      critChance: 0,
      magicResist: 0,
      moveSpeed: 0,
      maxHealth: 0,
      currentHealth: 0,
    },
  };
}

describe("createEnemyStatsStream", () => {
  it("emits empty map when no active player", () => {
    const liveState$ = new BehaviorSubject<LiveGameState>(
      createDefaultLiveGameState()
    );
    const { enemyStats$, subscription: sub } = createEnemyStatsStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    expect(enemyStats$.getValue().size).toBe(0);
  });

  it("computes enemy stats when game state has enemies", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = createActivePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 10,
        kills: 0,
        deaths: 0,
        assists: 0,
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
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [{ id: 6693, name: "Duskblade of Draktharr" }],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "Enemy1",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyStats$, subscription: sub } = createEnemyStatsStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    const stats = enemyStats$.getValue();
    expect(stats.size).toBe(1);
    expect(stats.has("Zed")).toBe(true);

    const zedStats = stats.get("Zed")!;
    // Zed base AD (63) + level 11 scaling + Duskblade (60 flat AD)
    expect(zedStats.attackDamage).toBeGreaterThan(63 + 60);
    expect(zedStats.armor).toBeGreaterThan(32);
  });

  it("recomputes when game state updates", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = createActivePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 10,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Player1",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "Zed",
        team: "CHAOS",
        level: 5,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "Enemy1",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyStats$, subscription: sub } = createEnemyStatsStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    const statsLevel5 = enemyStats$.getValue().get("Zed")!;

    // Update: Zed leveled up and bought an item
    const updated = { ...state };
    updated.players = [
      state.players[0],
      {
        ...state.players[1],
        level: 11,
        items: [{ id: 6693, name: "Duskblade of Draktharr" }],
      },
    ];
    liveState$.next(updated);

    const statsLevel11 = enemyStats$.getValue().get("Zed")!;
    expect(statsLevel11.attackDamage).toBeGreaterThan(statsLevel5.attackDamage);
  });

  it("skips enemies with unknown champion data", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = createActivePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 10,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Player1",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "UnknownChamp",
        team: "CHAOS",
        level: 5,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "Enemy1",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyStats$, subscription: sub } = createEnemyStatsStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    expect(enemyStats$.getValue().size).toBe(0);
  });
});
