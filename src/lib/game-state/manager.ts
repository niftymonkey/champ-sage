import type { GameState, ConnectionStatus } from "./types";
import { normalizeGameState } from "./normalize";

type Subscriber = (state: GameState) => void;

/**
 * Function that fetches raw game data from the Riot API.
 * Returns the parsed JSON on success.
 * Throws with message "LOADING" when the game is on the loading screen (404).
 * Throws with any other message when the game is not running.
 */
export type RiotApiFetcher = () => Promise<unknown>;

function createDisconnectedState(): GameState {
  return {
    status: "disconnected",
    activePlayer: null,
    players: [],
    gameMode: "",
    gameTime: 0,
  };
}

function createLoadingState(): GameState {
  return {
    status: "loading",
    activePlayer: null,
    players: [],
    gameMode: "",
    gameTime: 0,
  };
}

export class GameStateManager {
  private state: GameState = createDisconnectedState();
  private subscribers = new Set<Subscriber>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private fetcher: RiotApiFetcher;

  constructor(fetcher?: RiotApiFetcher) {
    this.fetcher = fetcher ?? createDefaultFetcher();
  }

  getState(): GameState {
    return this.state;
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  start(intervalMs = 2000): void {
    this.stop();
    this.poll();
    this.intervalId = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async poll(): Promise<void> {
    const previousStatus = this.state.status;
    let nextState: GameState;

    try {
      const data = await this.fetcher();
      nextState = normalizeGameState(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "LOADING") {
        nextState = createLoadingState();
      } else {
        nextState = createDisconnectedState();
      }
    }

    const changed = hasStateChanged(previousStatus, nextState, this.state);
    this.state = nextState;

    if (changed) {
      this.notify();
    }
  }

  private notify(): void {
    for (const fn of this.subscribers) {
      fn(this.state);
    }
  }
}

/**
 * Determine if the state has meaningfully changed. We always notify on
 * status transitions. When status is "connected", we also notify on
 * game time changes (which implies data has updated).
 */
function hasStateChanged(
  previousStatus: ConnectionStatus,
  next: GameState,
  prev: GameState
): boolean {
  if (next.status !== previousStatus) return true;
  if (next.status === "connected" && next.gameTime !== prev.gameTime)
    return true;
  return false;
}

/**
 * Default fetcher that uses the Tauri command to proxy through Rust,
 * which handles the self-signed cert on localhost:2999.
 */
function createDefaultFetcher(): RiotApiFetcher {
  return async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const json = await invoke<string>("fetch_riot_api", {
      endpoint: "/liveclientdata/allgamedata",
    });
    return JSON.parse(json);
  };
}
