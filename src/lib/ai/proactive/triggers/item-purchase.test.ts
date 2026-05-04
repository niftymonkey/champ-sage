import { describe, it, expect, vi } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import type {
  ActivePlayer,
  PlayerInfo,
  PlayerItem,
} from "../../../game-state/types";
import type { LiveGameState } from "../../../reactive/types";
import type { GamePlan } from "../../../reactive/coaching-feed-types";
import type { BuildPathItem } from "../../types";
import type { DecisionPointTrigger } from "../types";
import {
  createShopMomentTrigger,
  createGoldAvailableTrigger,
} from "./item-purchase";

// ─── Fixtures ───

function makeActivePlayer(overrides: Partial<ActivePlayer> = {}): ActivePlayer {
  return {
    championName: "Ahri",
    level: 10,
    currentGold: 0,
    runes: { keystone: "", primaryTree: "", secondaryTree: "" },
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
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    championName: "Ahri",
    team: "ORDER",
    level: 10,
    kills: 0,
    deaths: 0,
    assists: 0,
    items: [],
    summonerSpells: ["Flash", "Ignite"],
    riotIdGameName: "Player",
    position: "",
    isActivePlayer: true,
    ...overrides,
  };
}

function makeState(
  opts: {
    gold?: number;
    deaths?: number;
    items?: PlayerItem[];
    hasActivePlayer?: boolean;
  } = {}
): LiveGameState {
  const hasActive = opts.hasActivePlayer !== false;
  return {
    activePlayer: hasActive
      ? makeActivePlayer({ currentGold: opts.gold ?? 0 })
      : null,
    players: hasActive
      ? [
          makePlayer({
            isActivePlayer: true,
            deaths: opts.deaths ?? 0,
            items: opts.items ?? [],
          }),
        ]
      : [],
    gameMode: "ARAM",
    lcuGameMode: "ARAM",
    mapNumber: 0,
    gameTime: 600,
    champSelect: null,
    eogStats: null,
  };
}

function makeGamePlan(buildPath: BuildPathItem[]): GamePlan {
  return { summary: "test", buildPath, updatedAt: 0 };
}

function makeBuildItem(name: string): BuildPathItem {
  return { name, category: "core", targetEnemy: null, reason: "" };
}

// ─── Tests: shop-moment trigger ───

describe("createShopMomentTrigger", () => {
  it("emits when active-player deaths increment and gold ≥ default threshold", () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const handle = vi.fn().mockResolvedValue(undefined);
    const trigger = createShopMomentTrigger({ liveGameState$ }, handle);
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    liveGameState$.next(makeState({ gold: 1000, deaths: 2 }));
    liveGameState$.next(makeState({ gold: 1000, deaths: 3 }));

    expect(seen).toHaveLength(1);
    expect(seen[0].activePlayer?.currentGold).toBe(1000);
  });

  it("does NOT emit when gold is below threshold even on death", () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const handle = vi.fn();
    const trigger = createShopMomentTrigger(
      { liveGameState$, minGold: 700 },
      handle
    );
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    liveGameState$.next(makeState({ gold: 500, deaths: 1 }));
    liveGameState$.next(makeState({ gold: 600, deaths: 2 })); // died, but only 600g

    expect(seen).toHaveLength(0);
  });

  it("does NOT emit on non-death state changes (kills/items)", () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const trigger = createShopMomentTrigger({ liveGameState$ }, vi.fn());
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    liveGameState$.next(makeState({ gold: 1500, deaths: 0 }));
    liveGameState$.next(makeState({ gold: 1700, deaths: 0 })); // gold jumped, no death
    liveGameState$.next(makeState({ gold: 1700, deaths: 0 })); // no change

    expect(seen).toHaveLength(0);
  });

  it("does NOT emit when activePlayer is null", () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const trigger = createShopMomentTrigger({ liveGameState$ }, vi.fn());
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    liveGameState$.next(makeState({ hasActivePlayer: false }));
    liveGameState$.next(makeState({ hasActivePlayer: false }));

    expect(seen).toHaveLength(0);
  });

  it("respects custom minGold", () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const trigger = createShopMomentTrigger(
      { liveGameState$, minGold: 1500 },
      vi.fn()
    );
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    liveGameState$.next(makeState({ gold: 1000, deaths: 0 }));
    liveGameState$.next(makeState({ gold: 1000, deaths: 1 })); // below 1500

    expect(seen).toHaveLength(0);

    liveGameState$.next(makeState({ gold: 1600, deaths: 2 })); // above 1500

    expect(seen).toHaveLength(1);
  });

  it("declares the expected trigger metadata", () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const trigger = createShopMomentTrigger({ liveGameState$ }, vi.fn());
    expect(trigger.id).toBe("item-purchase-shop-moment");
    expect(trigger.decisionType).toBe("item-purchase");
    expect(trigger.debounceMs).toBe(0);
    expect(trigger.cooldownMs).toBeGreaterThanOrEqual(30_000);
    expect(trigger.respectGlobalGap).toBe(true);
  });

  it("suppresses subsequent deaths when inventory hasn't changed since last fire", async () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const handle = vi.fn<HandleFnLgs>().mockResolvedValue(undefined);
    const trigger = createShopMomentTrigger({ liveGameState$ }, handle);
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    // First death — fires, snapshot of inventory captured by wrapped handle.
    const items = [{ id: 3057, name: "Sheen" }];
    liveGameState$.next(makeState({ gold: 1000, deaths: 1, items }));
    liveGameState$.next(makeState({ gold: 1000, deaths: 2, items }));
    expect(seen).toHaveLength(1);
    await trigger.handle(seen[0], new AbortController().signal);

    // Second death — same items list, should be suppressed.
    liveGameState$.next(makeState({ gold: 1500, deaths: 3, items }));
    expect(seen).toHaveLength(1);

    // Third death — still same items, still suppressed even though gold changed.
    liveGameState$.next(makeState({ gold: 2200, deaths: 4, items }));
    expect(seen).toHaveLength(1);
  });

  it("fires again after the player completes a new item", async () => {
    const liveGameState$ = new Subject<LiveGameState>();
    const handle = vi.fn<HandleFnLgs>().mockResolvedValue(undefined);
    const trigger = createShopMomentTrigger({ liveGameState$ }, handle);
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));

    // First death with Sheen — fires.
    const before = [{ id: 3057, name: "Sheen" }];
    liveGameState$.next(makeState({ gold: 1000, deaths: 1, items: before }));
    liveGameState$.next(makeState({ gold: 1000, deaths: 2, items: before }));
    expect(seen).toHaveLength(1);
    await trigger.handle(seen[0], new AbortController().signal);

    // Player buys Trinity Force, then dies — items changed, fires again.
    const after = [
      { id: 3057, name: "Sheen" },
      { id: 3078, name: "Trinity Force" },
    ];
    liveGameState$.next(makeState({ gold: 200, deaths: 2, items: after }));
    liveGameState$.next(makeState({ gold: 1500, deaths: 3, items: after }));
    expect(seen).toHaveLength(2);
  });
});

type HandleFnLgs = DecisionPointTrigger<LiveGameState>["handle"];

// ─── Tests: gold-available trigger ───

// Detection-only tests. The 5s debounce declared by the trigger is applied
// by the ProactiveEngine, not by the trigger's source$ — engine.test.ts
// already covers debounce behavior. These tests subscribe to source$ directly
// and verify the cross-detection logic.
describe("createGoldAvailableTrigger", () => {
  // Use Subject (not BehaviorSubject) for liveGameState$ so each test
  // controls its own first emission. BehaviorSubject's default-state seed
  // would create a synthetic upward-cross at the first .next.
  function setup(
    opts: {
      plan?: GamePlan | null;
      costs?: Record<string, number>;
    } = {}
  ) {
    const liveGameState$ = new Subject<LiveGameState>();
    const gamePlan$ = new BehaviorSubject<GamePlan | null>(opts.plan ?? null);
    const costs = opts.costs ?? {};
    const trigger = createGoldAvailableTrigger(
      {
        liveGameState$,
        gamePlan$,
        getItemCost: (name) => costs[name] ?? null,
      },
      vi.fn()
    );
    const seen: LiveGameState[] = [];
    trigger.source$.subscribe((s) => seen.push(s));
    return { liveGameState$, gamePlan$, seen };
  }

  it("emits when gold crosses upward through the cheapest unpurchased item cost", async () => {
    const plan = makeGamePlan([makeBuildItem("Sheen")]);
    const { liveGameState$, seen } = setup({
      plan,
      costs: { Sheen: 700 },
    });

    liveGameState$.next(makeState({ gold: 600 }));
    liveGameState$.next(makeState({ gold: 700 })); // crosses upward

    expect(seen).toHaveLength(1);
    expect(seen[0].activePlayer?.currentGold).toBe(700);
  });

  it("does NOT emit when no game plan is loaded", async () => {
    const { liveGameState$, seen } = setup({ plan: null });

    liveGameState$.next(makeState({ gold: 600 }));
    liveGameState$.next(makeState({ gold: 1500 }));

    expect(seen).toHaveLength(0);
  });

  it("does NOT emit when all planned items are already owned", async () => {
    const plan = makeGamePlan([makeBuildItem("Sheen")]);
    const { liveGameState$, seen } = setup({
      plan,
      costs: { Sheen: 700 },
    });

    liveGameState$.next(
      makeState({ gold: 1500, items: [{ id: 3057, name: "Sheen" }] })
    );

    expect(seen).toHaveLength(0);
  });

  it("recomputes threshold after a planned item is purchased", async () => {
    const plan = makeGamePlan([
      makeBuildItem("Sheen"),
      makeBuildItem("Trinity Force"),
    ]);
    const { liveGameState$, seen } = setup({
      plan,
      costs: { Sheen: 700, "Trinity Force": 3300 },
    });

    // Cross 700 (Sheen threshold) — should emit
    liveGameState$.next(makeState({ gold: 600 }));
    liveGameState$.next(makeState({ gold: 700 }));
    expect(seen).toHaveLength(1);

    // Player buys Sheen — gold drops, items updated. Threshold becomes 3300.
    liveGameState$.next(
      makeState({ gold: 0, items: [{ id: 3057, name: "Sheen" }] })
    );

    // Cross 700 again on the way back up — should NOT emit; threshold is now 3300
    liveGameState$.next(
      makeState({ gold: 1000, items: [{ id: 3057, name: "Sheen" }] })
    );
    expect(seen).toHaveLength(1); // unchanged

    // Cross 3300 — should emit
    liveGameState$.next(
      makeState({ gold: 3300, items: [{ id: 3057, name: "Sheen" }] })
    );
    expect(seen).toHaveLength(2);
  });

  it("does NOT emit when gold is already above threshold continuously", async () => {
    const plan = makeGamePlan([makeBuildItem("Sheen")]);
    const { liveGameState$, seen } = setup({
      plan,
      costs: { Sheen: 700 },
    });

    // Player starts above threshold — no upward cross
    liveGameState$.next(makeState({ gold: 1000 }));
    liveGameState$.next(makeState({ gold: 1100 }));

    expect(seen).toHaveLength(0);
  });

  it("declares the expected trigger metadata", () => {
    const trigger = createGoldAvailableTrigger(
      {
        liveGameState$: new Subject(),
        gamePlan$: new BehaviorSubject<GamePlan | null>(null),
        getItemCost: () => null,
      },
      vi.fn()
    );
    expect(trigger.id).toBe("item-purchase-gold-available");
    expect(trigger.decisionType).toBe("item-purchase");
    expect(trigger.debounceMs).toBe(5_000);
    expect(trigger.cooldownMs).toBe(90_000);
    expect(trigger.respectGlobalGap).toBe(true);
  });
});
