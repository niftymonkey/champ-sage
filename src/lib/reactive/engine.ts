import {
  Observable,
  Subject,
  Subscription,
  interval,
  merge,
  timer,
  EMPTY,
} from "rxjs";
import {
  switchMap,
  filter,
  map,
  distinctUntilChanged,
  share,
  startWith,
} from "rxjs/operators";
import {
  gameLifecycle$,
  liveGameState$,
  createDefaultLiveGameState,
  notifications$,
  userInput$,
  manualInput$,
  playerIntent$,
} from "./streams";
import { normalizeGameState } from "../game-state/normalize";
import type { TauriBridge, LcuEventPayload } from "./tauri-bridge";
import type { GameflowPhase, LiveGameState, EogStats } from "./types";

const DISCOVERY_INTERVAL_MS = 3000;
const POLL_INTERVAL_MS = 2000;

/** Number of consecutive failures before surfacing a notification. */
const FAILURE_THRESHOLD = 20;
/** Initial backoff delay after threshold is hit. */
const BACKOFF_INITIAL_MS = 30_000;
/** Maximum backoff delay (capped). */
const BACKOFF_MAX_MS = 60_000;

const NOISE_PREFIXES = [
  "/patcher/",
  "/lol-patch/",
  "/data-store/",
  "/entitlements/",
  "/lol-honor-v2/",
];

/** Parse raw EOG stats JSON from the LCU into our EogStats shape. */
function parseEogStats(raw: Record<string, unknown>): EogStats {
  const teams = raw.teams as Array<{ isWinningTeam: boolean }> | undefined;
  const localPlayer = raw.localPlayer as
    | { championId: number; stats: Record<string, number> }
    | undefined;

  const isWin = teams?.[0]?.isWinningTeam ?? false;

  // Extract item IDs from stats (ITEM0..ITEM6), filtering out 0s
  const items: number[] = [];
  if (localPlayer?.stats) {
    for (let i = 0; i <= 6; i++) {
      const itemId = localPlayer.stats[`ITEM${i}`];
      if (itemId && itemId > 0) {
        items.push(itemId);
      }
    }
  }

  return {
    gameId: String(raw.gameId ?? ""),
    gameLength: Number(raw.gameLength ?? 0),
    gameMode: String(raw.gameMode ?? ""),
    isWin,
    championId: localPlayer?.championId ?? 0,
    items,
  };
}

export class ReactiveEngine {
  private subscription = new Subscription();
  private wsEvents$ = new Subject<LcuEventPayload>();
  private bridge: TauriBridge;

  // Track current LCU credentials for fetch_lcu calls (EOG stats)
  private currentPort = 0;
  private currentToken = "";

  // Error recovery state for Live Client Data polling
  private consecutiveFailures = 0;
  private backoffMs = POLL_INTERVAL_MS;
  private notified = false;

  constructor(bridge: TauriBridge) {
    this.bridge = bridge;
  }

  start(): void {
    this.stop();

    // Layer 1: LCU Discovery — poll lockfile periodically
    const lcuConnection$ = interval(DISCOVERY_INTERVAL_MS).pipe(
      startWith(0),
      switchMap(() =>
        this.bridge.discoverLcu().then(
          (creds) => ({ connected: true as const, ...creds }),
          () => ({ connected: false as const, port: 0, token: "" })
        )
      ),
      distinctUntilChanged(
        (a, b) => a.connected === b.connected && a.port === b.port
      ),
      share()
    );

    // Push connection events to gameLifecycle$ and track credentials
    this.subscription.add(
      lcuConnection$.subscribe((status) => {
        if (status.connected) {
          this.currentPort = status.port;
          this.currentToken = status.token;
        }
        gameLifecycle$.next({
          type: "connection",
          connected: status.connected,
        });
      })
    );

    // Layer 2: WebSocket — connect when LCU is discovered
    this.subscription.add(
      lcuConnection$
        .pipe(
          filter((s) => s.connected),
          switchMap((creds) => {
            return new Observable<void>((subscriber) => {
              let unlisten: (() => void) | null = null;
              let unlistenDisconnect: (() => void) | null = null;

              Promise.all([
                this.bridge.listenLcuEvent((event) =>
                  this.wsEvents$.next(event)
                ),
                this.bridge.listenLcuDisconnect(() => {
                  // Disconnect will be picked up by discovery polling
                }),
                this.bridge.connectLcuWebSocket(creds.port, creds.token),
              ])
                .then(([ul, uld]) => {
                  unlisten = ul;
                  unlistenDisconnect = uld;
                })
                .catch((err) => subscriber.error(err));

              return () => {
                unlisten?.();
                unlistenDisconnect?.();
              };
            });
          })
        )
        .subscribe()
    );

    // Layer 3: WebSocket event splits
    const wsFiltered$ = this.wsEvents$.pipe(
      filter(
        (evt) => !NOISE_PREFIXES.some((prefix) => evt.uri.startsWith(prefix))
      ),
      share()
    );

    const gameflowPhase$ = wsFiltered$.pipe(
      filter((evt) => evt.uri === "/lol-gameflow/v1/gameflow-phase"),
      map((evt) => evt.data as GameflowPhase),
      distinctUntilChanged(),
      share()
    );

    // Push phase events to gameLifecycle$
    this.subscription.add(
      gameflowPhase$.subscribe((phase) => {
        gameLifecycle$.next({ type: "phase", phase });
      })
    );

    // Push lobby events to gameLifecycle$
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-lobby/v2/lobby"),
          map((evt) => evt.data)
        )
        .subscribe((data) => {
          gameLifecycle$.next({ type: "lobby", data });
        })
    );

    // Push matchmaking events to gameLifecycle$
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-matchmaking/v1/search"),
          map((evt) => evt.data)
        )
        .subscribe((data) => {
          gameLifecycle$.next({ type: "matchmaking", data });
        })
    );

    // Push session events to gameLifecycle$
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-gameflow/v1/session"),
          map((evt) => evt.data)
        )
        .subscribe((data) => {
          gameLifecycle$.next({ type: "session", data });
        })
    );

    // Layer 4: Phase-gated Live Client Data API polling with error recovery
    this.subscription.add(
      gameflowPhase$
        .pipe(
          switchMap((phase) => {
            if (phase !== "InProgress") {
              // Reset live game state when leaving InProgress
              liveGameState$.next(createDefaultLiveGameState());

              // Clear any active error notification when leaving InProgress
              if (this.notified) {
                notifications$.next({
                  id: "live-data-clear",
                  level: "info",
                  message: "Game data polling stopped.",
                  timestamp: Date.now(),
                });
              }

              // Reset error recovery state
              this.consecutiveFailures = 0;
              this.backoffMs = POLL_INTERVAL_MS;
              this.notified = false;

              return EMPTY;
            }

            // Reset error recovery state for new InProgress phase
            this.consecutiveFailures = 0;
            this.backoffMs = POLL_INTERVAL_MS;
            this.notified = false;

            // Use a recursive schedule approach: emit a "tick" then schedule the next
            // based on current backoff state
            return this.createPollStream();
          })
        )
        .subscribe((state) => {
          liveGameState$.next(state);
        })
    );

    // End-of-game stats: fetch on PreEndOfGame transition
    this.subscription.add(
      gameflowPhase$
        .pipe(
          filter((phase) => phase === "PreEndOfGame"),
          switchMap(() =>
            this.bridge
              .fetchLcu(
                this.currentPort,
                this.currentToken,
                "/lol-end-of-game/v1/eog-stats-block"
              )
              .then(
                (json) => JSON.parse(json) as Record<string, unknown>,
                () => null
              )
          ),
          filter((data): data is Record<string, unknown> => data !== null)
        )
        .subscribe((eogData) => {
          const current = liveGameState$.getValue();
          liveGameState$.next({
            ...current,
            eogStats: parseEogStats(eogData),
          });
        })
    );

    // Slice 6a: Champ select → liveGameState$
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-champ-select/v1/session"),
          map((evt) => evt.data)
        )
        .subscribe((data) => {
          const current = liveGameState$.getValue();
          liveGameState$.next({ ...current, champSelect: data });
        })
    );

    // Slice 6b: Merge manualInput$ and playerIntent$ → userInput$
    this.subscription.add(
      merge(manualInput$, playerIntent$).subscribe((event) => {
        userInput$.next(event);
      })
    );
  }

  /**
   * Creates a polling Observable that adapts its interval based on error recovery state.
   * Normal mode: polls every 2s. After FAILURE_THRESHOLD consecutive failures, switches
   * to backoff mode (30s, then 60s capped).
   */
  private createPollStream(): Observable<LiveGameState> {
    // Use a Subject to drive recursive scheduling
    const tick$ = new Subject<void>();

    const scheduleTick = (): void => {
      const delay = this.backoffMs;
      const sub = timer(delay).subscribe(() => {
        tick$.next();
      });
      this.subscription.add(sub);
    };

    return new Observable<LiveGameState>((subscriber) => {
      // Accumulate state through the polling lifecycle
      let gameState = createDefaultLiveGameState();

      const doPoll = (): void => {
        this.bridge
          .fetchRiotApi("/liveclientdata/allgamedata")
          .then(
            (json) => {
              const raw: unknown = JSON.parse(json);
              return { success: true as const, data: normalizeGameState(raw) };
            },
            () => ({ success: false as const, data: null })
          )
          .then((result) => {
            if (result.success && result.data) {
              // Recovery path
              const wasNotified = this.notified;
              this.consecutiveFailures = 0;
              this.backoffMs = POLL_INTERVAL_MS;
              this.notified = false;

              if (wasNotified) {
                notifications$.next({
                  id: "live-data-recovery",
                  level: "info",
                  message: "Game data connection restored.",
                  timestamp: Date.now(),
                });
              }

              gameState = {
                ...gameState,
                activePlayer: result.data.activePlayer,
                players: result.data.players,
                gameMode: result.data.gameMode,
                gameTime: result.data.gameTime,
              };
              subscriber.next(gameState);
            } else {
              // Failure path
              this.consecutiveFailures++;

              if (
                this.consecutiveFailures >= FAILURE_THRESHOLD &&
                !this.notified
              ) {
                this.notified = true;
                this.backoffMs = BACKOFF_INITIAL_MS;

                notifications$.next({
                  id: "live-data-connection",
                  level: "error",
                  message: "Game data connection lost. Retrying...",
                  timestamp: Date.now(),
                });
              } else if (this.notified) {
                // Escalate backoff
                this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
              }
            }

            // Schedule next poll
            scheduleTick();
          });
      };

      // Initial poll fires immediately
      doPoll();

      // Subsequent polls driven by tick$
      const tickSub = tick$.subscribe(() => {
        doPoll();
      });

      return () => {
        tickSub.unsubscribe();
      };
    });
  }

  stop(): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
  }
}
