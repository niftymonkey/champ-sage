import { describe, it, expect, afterEach } from "vitest";
import { BehaviorSubject, type Subscription } from "rxjs";
import { createEnemyDirectionStream } from "./stream";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { Champion, Item } from "../data-ingest/types";

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
    mapNumber: 0,
    lcuGameId: "",
    gameTime: 0,
    champSelect: null,
    eogStats: null,
  };
}

function makeChampion(overrides: Partial<Champion> = {}): Champion {
  return {
    id: "X",
    key: 1,
    name: "X",
    title: "",
    tags: ["Fighter"],
    partype: "Mana",
    stats: {
      hp: 600,
      hpperlevel: 100,
      mp: 300,
      mpperlevel: 50,
      movespeed: 340,
      armor: 30,
      armorperlevel: 4,
      spellblock: 30,
      spellblockperlevel: 2,
      attackrange: 175,
      hpregen: 5,
      hpregenperlevel: 0.5,
      mpregen: 7,
      mpregenperlevel: 0.5,
      attackdamage: 60,
      attackdamageperlevel: 3,
      attackspeed: 0.65,
      attackspeedperlevel: 3,
    },
    image: "",
    ...overrides,
  };
}

function makeItem(id: number, overrides: Partial<Item> = {}): Item {
  return {
    id,
    name: `Item ${id}`,
    description: "",
    plaintext: "",
    gold: { base: 0, total: 0, sell: 0, purchasable: true },
    tags: [],
    stats: {},
    image: "",
    mode: "standard",
    into: [],
    ...overrides,
  };
}

function createGameData(): LoadedGameData {
  const champions = new Map<string, Champion>([
    [
      "malphite",
      makeChampion({
        id: "Malphite",
        name: "Malphite",
        tags: ["Tank", "Mage"],
      }),
    ],
    ["zed", makeChampion({ id: "Zed", name: "Zed", tags: ["Assassin"] })],
    [
      "soraka",
      makeChampion({ id: "Soraka", name: "Soraka", tags: ["Support"] }),
    ],
  ]);

  const items = new Map<number, Item>([
    [1001, makeItem(1001, { stats: { FlatMagicDamageMod: 100 } })], // AP
    [1002, makeItem(1002, { stats: { FlatPhysicalDamageMod: 70 } })], // AD
    [1003, makeItem(1003, { stats: { FlatArmorMod: 50, FlatHPPoolMod: 400 } })], // tank
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

function activePlayerStub() {
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

describe("createEnemyDirectionStream", () => {
  it("emits empty map when no active player on field", () => {
    const liveState$ = new BehaviorSubject<LiveGameState>(
      createDefaultLiveGameState()
    );
    const { enemyDirections$, subscription: sub } = createEnemyDirectionStream(
      liveState$,
      createGameData()
    );
    subscription = sub;
    expect(enemyDirections$.getValue().size).toBe(0);
  });

  it("emits stereotype reading for each enemy when no items owned", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = activePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Me",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "Malphite",
        team: "CHAOS",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "E1",
        position: "",
        isActivePlayer: false,
      },
      {
        championName: "Zed",
        team: "CHAOS",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "E2",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyDirections$, subscription: sub } = createEnemyDirectionStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    const directions = enemyDirections$.getValue();
    expect(directions.size).toBe(2);
    expect(directions.get("Malphite")).toEqual({
      direction: "tank",
      confidence: "stereotype",
    });
    expect(directions.get("Zed")).toEqual({
      direction: "ad",
      confidence: "stereotype",
    });
  });

  it("recomputes when an enemy buys items", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = activePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Me",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "Malphite",
        team: "CHAOS",
        level: 6,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "E1",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyDirections$, subscription: sub } = createEnemyDirectionStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    expect(enemyDirections$.getValue().get("Malphite")).toEqual({
      direction: "tank",
      confidence: "stereotype",
    });

    const updated: LiveGameState = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          items: [{ id: 1001, name: "Item 1001" }],
        },
      ],
    };
    liveState$.next(updated);

    expect(enemyDirections$.getValue().get("Malphite")).toEqual({
      direction: "ap",
      confidence: "low",
    });
  });

  it("preserves hysteresis across emissions", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = activePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Me",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "Malphite",
        team: "CHAOS",
        level: 11,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [
          { id: 1001, name: "Item 1001" },
          { id: 1001, name: "Item 1001" },
        ],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "E1",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyDirections$, subscription: sub } = createEnemyDirectionStream(
      liveState$,
      createGameData()
    );
    subscription = sub;

    expect(enemyDirections$.getValue().get("Malphite")).toEqual({
      direction: "ap",
      confidence: "high",
    });

    // Buy 2 tank items — tied 2-2 with previous AP. Hysteresis keeps AP.
    const tied: LiveGameState = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          items: [
            { id: 1001, name: "Item 1001" },
            { id: 1001, name: "Item 1001" },
            { id: 1003, name: "Item 1003" },
            { id: 1003, name: "Item 1003" },
          ],
        },
      ],
    };
    liveState$.next(tied);

    expect(enemyDirections$.getValue().get("Malphite")).toEqual({
      direction: "ap",
      confidence: "high",
    });
  });

  it("skips enemies whose champion is unknown to gameData", () => {
    const state = createDefaultLiveGameState();
    state.activePlayer = activePlayerStub();
    state.players = [
      {
        championName: "Ahri",
        team: "ORDER",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Mark"],
        riotIdGameName: "Me",
        position: "",
        isActivePlayer: true,
      },
      {
        championName: "UnknownChamp",
        team: "CHAOS",
        level: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        items: [],
        summonerSpells: ["Flash", "Ignite"],
        riotIdGameName: "E1",
        position: "",
        isActivePlayer: false,
      },
    ];

    const liveState$ = new BehaviorSubject<LiveGameState>(state);
    const { enemyDirections$, subscription: sub } = createEnemyDirectionStream(
      liveState$,
      createGameData()
    );
    subscription = sub;
    expect(enemyDirections$.getValue().size).toBe(0);
  });
});
