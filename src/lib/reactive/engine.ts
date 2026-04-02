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
import type { PlatformBridge, LcuEventPayload } from "./platform-bridge";
import type { GameflowPhase, LiveGameState, EogStats } from "./types";
import { formatGameTime } from "../format";
import {
  isDebugWorthy,
  shouldLogPollStatus,
  shouldLogWebSocketEvent,
  describeEvent,
} from "./debug-filters";
import { getLogger } from "../logger";

const engineLog = getLogger("engine");

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
  "/lol-chat/",
  "/lol-loot/",
  "/lol-regalia/",
  "/lol-pre-end-of-game/",
  "/lol-champion-mastery/",
  "/lol-ranked/",
  "/lol-clash/",
  "/lol-collections/",
  "/lol-cosmetics/",
  "/lol-replays/",
  "/lol-simple-dialog-messages/",
  "/lol-premade-voice/",
  "/riot-messaging-service/",
  "/riotclient/",
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
  private bridge: PlatformBridge;

  // Track current LCU credentials for fetch_lcu calls (EOG stats)
  private currentPort = 0;
  private currentToken = "";

  // LCU game mode (KIWI for Mayhem, CLASSIC for SR, CHERRY for Arena)
  private lcuGameMode = "";

  // Incremented on WebSocket failure to force discovery re-emit
  private wsRetrySeq = 0;

  // Error recovery state for Live Client Data polling
  private consecutiveFailures = 0;
  private lastPollStatus: string | null = null;
  private backoffMs = POLL_INTERVAL_MS;
  private notified = false;

  constructor(bridge: PlatformBridge) {
    this.bridge = bridge;
  }

  start(): void {
    this.stop();

    // Layer 1: LCU Discovery — poll lockfile periodically
    const lcuConnection$ = interval(DISCOVERY_INTERVAL_MS).pipe(
      startWith(0),
      switchMap(() =>
        this.bridge.discoverLcu().then(
          (creds) => ({
            connected: true as const,
            ...creds,
            seq: this.wsRetrySeq,
          }),
          () => ({
            connected: false as const,
            port: 0,
            token: "",
            seq: this.wsRetrySeq,
          })
        )
      ),
      distinctUntilChanged(
        (a, b) =>
          a.connected === b.connected && a.port === b.port && a.seq === b.seq
      ),
      share()
    );

    // Push connection events to gameLifecycle$ and track credentials
    this.subscription.add(
      lcuConnection$.subscribe((status) => {
        // Only log discovery when connection status or port actually changes
        // (not on retry seq bumps — those just re-trigger WebSocket connection)
        const isNewDiscovery =
          this.currentPort !== status.port ||
          (status.connected && this.currentPort === 0);
        if (isNewDiscovery || !status.connected) {
          engineLog.info(
            status.connected
              ? `LCU found — port ${status.port}`
              : "LCU not found"
          );
        }
        if (status.connected) {
          this.currentPort = status.port;
          this.currentToken = status.token;
        }
        // Only emit if the connection status actually changed from what
        // the BehaviorSubject already holds (avoids duplicate on startup)
        const current = gameLifecycle$.getValue();
        if (
          current.type !== "connection" ||
          current.connected !== status.connected
        ) {
          gameLifecycle$.next({
            type: "connection",
            connected: status.connected,
          });
        }
      })
    );

    // Layer 2: WebSocket — connect when LCU is discovered
    this.subscription.add(
      lcuConnection$
        .pipe(
          filter((s) => s.connected),
          switchMap((creds) => {
            return new Observable<void>(() => {
              const isRetry = this.wsRetrySeq > 0;
              engineLog.info(
                isRetry
                  ? `Retrying WebSocket connection... (attempt ${this.wsRetrySeq + 1})`
                  : `Connecting WebSocket to port ${creds.port}...`
              );

              // Register IPC listeners synchronously — unlisten functions are
              // available immediately, so cleanup works even if stop() is called
              // before the WebSocket finishes connecting (React StrictMode remount).
              const unlisten = this.bridge.listenLcuEvent((event) =>
                this.wsEvents$.next(event)
              );
              // Track whether this connection attempt already failed
              // to avoid double-logging (error + close both fire on failure)
              let failed = false;

              const unlistenDisconnect = this.bridge.listenLcuDisconnect(
                (event) => {
                  if (failed) return;
                  failed = true;
                  engineLog.warn(`WebSocket disconnected: ${event.reason}`);
                  this.wsRetrySeq++;
                }
              );

              this.bridge
                .connectLcuWebSocket(creds.port, creds.token)
                .then(() => {
                  engineLog.info("WebSocket connected and subscribed");
                  this.fetchInitialState(creds.port, creds.token);
                })
                .catch((err) => {
                  if (failed) return;
                  failed = true;
                  engineLog.warn(
                    `WebSocket connection failed: ${err instanceof Error ? err.message : String(err)}`
                  );
                  this.wsRetrySeq++;
                });

              return () => {
                unlisten();
                unlistenDisconnect();
              };
            });
          })
        )
        .subscribe()
    );

    // Layer 3: WebSocket event splits
    this.subscription.add(
      this.wsEvents$.subscribe((evt) => {
        if (isDebugWorthy(evt.uri) && shouldLogWebSocketEvent(evt.uri)) {
          engineLog.debug(describeEvent(evt.event_type, evt.uri));
        }
      })
    );

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

    // Push lobby events to gameLifecycle$ (deduplicated)
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-lobby/v2/lobby"),
          map((evt) => JSON.stringify(evt.data)),
          distinctUntilChanged(),
          map((json) => JSON.parse(json) as unknown)
        )
        .subscribe((data) => {
          gameLifecycle$.next({ type: "lobby", data });
        })
    );

    // Push matchmaking events to gameLifecycle$ (deduplicated)
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-matchmaking/v1/search"),
          map((evt) => JSON.stringify(evt.data)),
          distinctUntilChanged(),
          map((json) => JSON.parse(json) as unknown)
        )
        .subscribe((data) => {
          gameLifecycle$.next({ type: "matchmaking", data });
        })
    );

    // Push session events to gameLifecycle$ (deduplicated)
    this.subscription.add(
      wsFiltered$
        .pipe(
          filter((evt) => evt.uri === "/lol-gameflow/v1/session"),
          map((evt) => JSON.stringify(evt.data)),
          distinctUntilChanged(),
          map((json) => JSON.parse(json) as unknown)
        )
        .subscribe((data) => {
          gameLifecycle$.next({ type: "session", data });
          // Extract LCU game mode from session (e.g., KIWI for Mayhem)
          const session = data as Record<string, unknown> | null;
          const gameData = session?.gameData as
            | Record<string, unknown>
            | undefined;
          const queue = gameData?.queue as Record<string, unknown> | undefined;
          const lcuMode = queue?.gameMode as string | undefined;
          if (lcuMode) {
            this.lcuGameMode = lcuMode;
          }
        })
    );

    // Layer 4: Phase-gated Live Client Data API polling with error recovery
    this.subscription.add(
      gameflowPhase$
        .pipe(
          switchMap((phase) => {
            if (phase !== "InProgress") {
              liveGameState$.next(createDefaultLiveGameState());
              this.lcuGameMode = "";
              this.lastPollStatus = null;

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
   * Fetch the current gameflow phase and session via REST on initial connect.
   * This ensures we pick up the current state even if the app started after
   * the phase transition already happened (e.g., game already InProgress).
   */
  private fetchInitialState(port: number, token: string): void {
    // Fetch current phase
    this.bridge
      .fetchLcu(port, token, "/lol-gameflow/v1/gameflow-phase")
      .then((json) => {
        const phase = JSON.parse(json) as string;
        engineLog.debug(`Initial phase: ${phase}`);
        if (phase && phase !== "None") {
          this.wsEvents$.next({
            uri: "/lol-gameflow/v1/gameflow-phase",
            event_type: "Update",
            data: phase,
          });
        }
      })
      .catch((err) => {
        engineLog.warn(
          `Initial phase fetch failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });

    // Fetch current session
    this.bridge
      .fetchLcu(port, token, "/lol-gameflow/v1/session")
      .then((json) => {
        const session: unknown = JSON.parse(json);
        engineLog.debug("Initial session fetched");
        this.wsEvents$.next({
          uri: "/lol-gameflow/v1/session",
          event_type: "Update",
          data: session,
        });
      })
      .catch(() => {
        engineLog.debug("Initial session not available");
      });
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
              const normalized = normalizeGameState(raw);
              const status = `OK — ${normalized.gameMode} ${formatGameTime(normalized.gameTime)} ${normalized.players.length}p`;
              if (shouldLogPollStatus("OK", this.lastPollStatus)) {
                engineLog.debug(`Poll ${status}`);
              }
              this.lastPollStatus = "OK";
              return { success: true as const, data: normalized };
            },
            (err) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              const status = errMsg.includes("LOADING")
                ? "LOADING"
                : "CONNECTION_FAILED";
              if (shouldLogPollStatus(status, this.lastPollStatus)) {
                engineLog.warn(`Poll failed — ${errMsg}`);
              }
              this.lastPollStatus = status;
              return { success: false as const, data: null };
            }
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
                lcuGameMode: this.lcuGameMode,
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
