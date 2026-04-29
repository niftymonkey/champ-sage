import { combineLatest, type Observable } from "rxjs";
import { filter, map, pairwise, tap } from "rxjs/operators";
import type { LiveGameState } from "../../../reactive/types";
import type { GamePlan } from "../../../reactive/coaching-feed-types";
import { getLogger } from "../../../logger";
import type { DecisionPointTrigger } from "../types";

const log = getLogger("coaching:proactive");

// ─── shop-moment trigger ───

/**
 * Triggers proactive item-rec advice when the player dies with enough gold to
 * buy something meaningful. The discrete death event (single emission, no
 * debounce) gives the player advice while they're at the shop.
 *
 * Gold gate prevents firing when the player can't afford anything useful
 * regardless of what we'd suggest.
 */
export interface ShopMomentTriggerDeps {
  liveGameState$: Observable<LiveGameState>;
  /** Minimum gold required to fire. Default 700 — cheapest meaningful component tier. */
  minGold?: number;
}

export const SHOP_MOMENT_DEFAULT_MIN_GOLD = 700;
export const SHOP_MOMENT_COOLDOWN_MS = 30_000;

function activePlayerDeaths(state: LiveGameState): number | null {
  if (!state.activePlayer) return null;
  const me = state.players.find((p) => p.isActivePlayer);
  return me?.deaths ?? null;
}

function activePlayerItems(state: LiveGameState): Set<string> {
  const me = state.players.find((p) => p.isActivePlayer);
  return new Set(me?.items.map((i) => i.name) ?? []);
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function createShopMomentTrigger(
  deps: ShopMomentTriggerDeps,
  handle: DecisionPointTrigger<LiveGameState>["handle"]
): DecisionPointTrigger<LiveGameState> {
  const minGold = deps.minGold ?? SHOP_MOMENT_DEFAULT_MIN_GOLD;
  // Track items at the most recent successful fire. Suppress subsequent fires
  // until inventory actually changes — prevents the LLM from being asked the
  // same question again across consecutive deaths when the player hasn't been
  // able to act on prior advice (e.g. couldn't afford the suggested item yet).
  // Closure resets when the trigger is recreated (per-game lifecycle in
  // CoachingPipeline's session-init effect).
  let lastFiredItems: ReadonlySet<string> | null = null;

  const wrappedHandle: DecisionPointTrigger<LiveGameState>["handle"] = async (
    state,
    signal
  ) => {
    const snapshot = activePlayerItems(state);
    lastFiredItems = snapshot;
    log.info(
      `[shop-moment] Items at fire: [${[...snapshot].join(", ") || "(empty)"}]`
    );
    await handle(state, signal);
  };

  return {
    id: "item-purchase-shop-moment",
    decisionType: "item-purchase",
    source$: deps.liveGameState$.pipe(
      pairwise(),
      tap(([prev, curr]) => {
        const prevDeaths = activePlayerDeaths(prev);
        const currDeaths = activePlayerDeaths(curr);
        if (
          prevDeaths !== null &&
          currDeaths !== null &&
          currDeaths > prevDeaths
        ) {
          const gold = curr.activePlayer?.currentGold ?? 0;
          if (gold < minGold) {
            log.info(
              `[shop-moment] Death detected but gold below threshold: gold=${gold} < minGold=${minGold} (deaths ${prevDeaths}→${currDeaths})`
            );
          } else {
            log.info(
              `[shop-moment] Detection: death + gold-gate cleared (gold=${gold}, deaths ${prevDeaths}→${currDeaths})`
            );
          }
        }
      }),
      filter(([prev, curr]) => {
        const prevDeaths = activePlayerDeaths(prev);
        const currDeaths = activePlayerDeaths(curr);
        if (prevDeaths === null || currDeaths === null) return false;
        if (currDeaths <= prevDeaths) return false;
        const gold = curr.activePlayer?.currentGold ?? 0;
        return gold >= minGold;
      }),
      filter(([, curr]) => {
        // Inventory-change gate: skip if items haven't changed since last fire.
        if (lastFiredItems === null) return true;
        const currItems = activePlayerItems(curr);
        if (setsEqual(currItems, lastFiredItems)) {
          log.info(
            `[shop-moment] SUPPRESSED — no inventory change since last fire (items=[${[...currItems].join(", ") || "(empty)"}])`
          );
          return false;
        }
        return true;
      }),
      map(([, curr]) => curr)
    ),
    debounceMs: 0,
    cooldownMs: SHOP_MOMENT_COOLDOWN_MS,
    respectGlobalGap: true,
    handle: wrappedHandle,
  };
}

// ─── gold-available trigger ───

/**
 * Triggers proactive item-rec advice when the player's gold crosses upward
 * through the cost threshold of the cheapest unpurchased item in the current
 * game plan. Forward-looking — gives the player time to plan their next shop
 * trip rather than reacting to a death.
 *
 * Skips silently when no game plan is loaded or all planned items are owned.
 */
export interface GoldAvailableTriggerDeps {
  liveGameState$: Observable<LiveGameState>;
  gamePlan$: Observable<GamePlan | null>;
  /** Look up an item's total cost by name. Returns null if item is unknown. */
  getItemCost: (name: string) => number | null;
}

export const GOLD_AVAILABLE_DEBOUNCE_MS = 5_000;
export const GOLD_AVAILABLE_COOLDOWN_MS = 90_000;

interface GoldAvailableContext {
  state: LiveGameState;
  gold: number;
  threshold: number;
}

function cheapestUnpurchasedCost(
  plan: GamePlan,
  ownedNames: ReadonlySet<string>,
  getItemCost: (name: string) => number | null
): number | null {
  let min: number | null = null;
  for (const item of plan.buildPath) {
    if (ownedNames.has(item.name)) continue;
    const cost = getItemCost(item.name);
    if (cost == null) continue;
    if (min == null || cost < min) min = cost;
  }
  return min;
}

function buildContext(
  state: LiveGameState,
  plan: GamePlan | null,
  getItemCost: (name: string) => number | null
): GoldAvailableContext | null {
  if (!plan) return null;
  const me = state.players.find((p) => p.isActivePlayer);
  const ownedNames = new Set(me?.items.map((i) => i.name) ?? []);
  const threshold = cheapestUnpurchasedCost(plan, ownedNames, getItemCost);
  if (threshold == null) return null;
  const gold = state.activePlayer?.currentGold ?? 0;
  return { state, gold, threshold };
}

export function createGoldAvailableTrigger(
  deps: GoldAvailableTriggerDeps,
  handle: DecisionPointTrigger<LiveGameState>["handle"]
): DecisionPointTrigger<LiveGameState> {
  // Track threshold changes so we log the initial value plus each transition
  // (player completes a planned item → cheapest-unowned recomputes). Without
  // these logs the "no fire this game" case is opaque — we can't tell whether
  // the context was being built, what threshold was computed, or whether gold
  // was already above on first observation (in which case no upward cross
  // ever fires from that vantage point).
  let lastLoggedThreshold: number | null = null;

  return {
    id: "item-purchase-gold-available",
    decisionType: "item-purchase",
    source$: combineLatest([deps.liveGameState$, deps.gamePlan$]).pipe(
      map(([state, plan]) => buildContext(state, plan, deps.getItemCost)),
      filter((ctx): ctx is GoldAvailableContext => ctx !== null),
      tap((ctx) => {
        if (lastLoggedThreshold !== ctx.threshold) {
          const label = lastLoggedThreshold === null ? "initial" : "changed";
          const position =
            ctx.gold >= ctx.threshold ? "ALREADY above" : "below";
          log.info(
            `[gold-available] Threshold ${label}: ${ctx.threshold} (current gold=${ctx.gold}, ${position} threshold)`
          );
          lastLoggedThreshold = ctx.threshold;
        }
      }),
      pairwise(),
      // Upward cross: prev was below the CURRENT threshold, curr is at or above.
      // Using curr.threshold for both sides means a threshold change (player
      // bought a planned item) doesn't retroactively trigger — the new
      // threshold is only crossed when gold actually rises past it.
      tap(([prev, curr]) => {
        if (prev.gold < curr.threshold && curr.gold >= curr.threshold) {
          log.info(
            `[gold-available] Detection: upward cross (gold ${prev.gold}→${curr.gold} crossed threshold=${curr.threshold})`
          );
        }
      }),
      filter(([prev, curr]) => {
        return prev.gold < curr.threshold && curr.gold >= curr.threshold;
      }),
      map(([, curr]) => curr.state)
    ),
    debounceMs: GOLD_AVAILABLE_DEBOUNCE_MS,
    cooldownMs: GOLD_AVAILABLE_COOLDOWN_MS,
    respectGlobalGap: true,
    handle,
  };
}
