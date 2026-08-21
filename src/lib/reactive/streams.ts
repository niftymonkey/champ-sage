import { BehaviorSubject, Subject, combineLatest, map } from "rxjs";
import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
  CoachingMessage,
  AppNotification,
} from "./types";
import { createStatusRegistry } from "../app-status";
import type { SubsystemId, SubsystemStatus } from "../app-status";

function createDefaultLiveGameState(): LiveGameState {
  return {
    activePlayer: null,
    players: [],
    gameMode: "",
    lcuGameMode: "",
    mapNumber: 0,
    lcuGameId: "",
    gameTime: 0,
    champSelect: null,
    eogStats: null,
  };
}

// The 5 app-level observables
export const gameLifecycle$ = new BehaviorSubject<GameLifecycleEvent>({
  type: "connection",
  connected: false,
});

export const liveGameState$ = new BehaviorSubject<LiveGameState>(
  createDefaultLiveGameState()
);

export const userInput$ = new Subject<UserInputEvent>();
export const coaching$ = new Subject<CoachingMessage>();
export const notifications$ = new Subject<AppNotification>();

// User input subjects (for pushing from UI)
export const manualInput$ = new Subject<UserInputEvent & { type: "augment" }>();
export const playerIntent$ = new Subject<UserInputEvent & { type: "query" }>();

/**
 * LCU credentials current value — null when no LCU connection has been
 * discovered yet (or after a disconnect). The engine writes here when
 * lockfile discovery succeeds; renderer-side consumers (match history)
 * subscribe to drive their own LCU fetches without re-implementing
 * discovery.
 */
export const lcuCredentials$ = new BehaviorSubject<{
  port: number;
  token: string;
} | null>(null);

/**
 * `true` once the LCU's HTTPS server is actually accepting connections
 * (signaled by the engine's WebSocket having connected and subscribed).
 * `false` when no LCU is discovered or the WebSocket has dropped.
 *
 * Distinct from `lcuCredentials$`, which fires the moment the lockfile
 * is found — typically several seconds before the HTTPS server is bound.
 * Consumers that need to actually call LCU endpoints (match-history) should
 * subscribe to this signal instead of credentials, otherwise their first
 * fetch reliably fails with ECONNREFUSED and they pay the retry-backoff
 * latency before the data lands.
 */
export const lcuReady$ = new BehaviorSubject<boolean>(false);

/**
 * Fires once when a game has ended (eogStats arrived in liveGameState$).
 * Renderer-side consumers (match history) refresh on this signal so the
 * just-finished match shows up without a manual reload.
 */
export const gameEnded$ = new Subject<void>();

// Debug stream — raw input events from data sources (discovery, WebSocket, API polls)
export interface DebugInputEvent {
  source:
    | "discovery"
    | "websocket"
    | "ws-filtered"
    | "riot-api"
    | "lcu-rest"
    | "initial-state"
    | "voice"
    | "llm"
    | "gep";
  summary: string;
  detail?: string;
}

export const debugInput$ = new Subject<DebugInputEvent>();

/**
 * Subsystem health as the main process sees it: boot, launch, GEP, Overwolf
 * packages, settings.
 */
export const mainStatus$ = new BehaviorSubject<SubsystemStatus[]>([]);

/**
 * Subsystem health only the renderer can know.
 *
 * A data-ingest failure or a missing preload bridge never reaches the main
 * process, so it has no way to report them. Without this stream those failures
 * would be the one class of problem the status surface cannot show, which is
 * the gap the surface exists to close.
 */
export const localStatus$ = new BehaviorSubject<SubsystemStatus[]>([]);

/**
 * The renderer's own registry, feeding `localStatus$`.
 *
 * The same `createStatusRegistry` the main process uses, so renderer-side
 * reporting gets the one-entry-per-subsystem rule, the `ok`-is-a-clear rule,
 * and the copy-on-the-boundary guarantee for free rather than each hook doing
 * its own array surgery on the subject.
 */
export const localStatusRegistry = createStatusRegistry();

/**
 * Every subsystem the renderer has ever had an opinion about.
 *
 * The registry turns `ok` into a deletion, so a clear would otherwise leave
 * nothing on `localStatus$` for the merge to act on, and the merge would fall
 * back to whatever the main process last said. A main-process report the
 * renderer has since disproved would then keep its banner up forever, with
 * nothing left in the app able to take it down.
 */
const rendererReported = new Set<SubsystemId>();

localStatusRegistry.subscribe((all) => {
  for (const s of all) rendererReported.add(s.id);
  const live = new Set(all.map((s) => s.id));
  // An explicit "the renderer looked, and this one is fine", which the merge
  // lets win for the id and then drops rather than rendering.
  const cleared: SubsystemStatus[] = [...rendererReported]
    .filter((id) => !live.has(id))
    .map((id) => ({ id, level: "ok", message: "" }));
  localStatus$.next([...all, ...cleared]);
});

/**
 * Everything wrong with the app right now, worst first.
 *
 * Both sides can report the same subsystem (`data` is renderer-only today, but
 * nothing structurally stops an overlap), so the renderer's view wins for a
 * given id: it is the side closer to what the player is actually looking at.
 */
/** Display order. `ok` is filtered out before this is consulted. */
const STATUS_ORDER: Record<SubsystemStatus["level"], number> = {
  broken: 0,
  degraded: 1,
  updating: 2,
  ok: 3,
};

/**
 * Folds both processes' views into one worst-first list.
 *
 * The renderer's entry wins for a subsystem both reported: it is the side
 * closer to what the player is looking at. `ok` is dropped rather than
 * rendered, which is also how a renderer-side clear takes down something the
 * main process raised: the renderer publishes an `ok` tombstone, it wins for
 * the id here, and then it is filtered out. Both registries refuse `ok` on the
 * way in, so this filter is also the last place an "I am fine" arriving over
 * the bridge from an older main process can be stopped from becoming a banner.
 */
export function mergeStatuses(
  fromMain: SubsystemStatus[],
  fromRenderer: SubsystemStatus[]
): SubsystemStatus[] {
  const byId = new Map<SubsystemStatus["id"], SubsystemStatus>();
  for (const status of [...fromMain, ...fromRenderer]) {
    byId.set(status.id, status);
  }
  return [...byId.values()]
    .filter((s) => s.level !== "ok")
    .sort((a, b) => STATUS_ORDER[a.level] - STATUS_ORDER[b.level]);
}

export const appStatus$ = combineLatest([mainStatus$, localStatus$]).pipe(
  map(([fromMain, fromRenderer]) => mergeStatuses(fromMain, fromRenderer))
);

export { createDefaultLiveGameState };
