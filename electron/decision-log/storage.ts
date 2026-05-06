import type {
  DecisionRecord,
  RecoveryWarning,
} from "../../src/lib/decision-log/types";

/**
 * Internal seam between the decision log core and its persistence
 * mechanism. The log core handles validation, ordering, and queries;
 * the storage adapter is dumb persistence.
 */
export interface DecisionStorage {
  /**
   * Read every persisted record at startup. Records are returned grouped by
   * gameId so the log can hydrate its in-memory index without re-bucketing.
   * Implementations recover from corruption silently and report dropped
   * lines via `warnings`; the log surfaces those for diagnostics.
   */
  hydrate(): Promise<{
    games: Array<{ gameId: string; records: DecisionRecord[] }>;
    warnings: RecoveryWarning[];
  }>;

  /**
   * Append a single record. Resolves only when the record is durable enough
   * for the adapter (file: fsync; memory: synchronous). Rejects on IO
   * failure; the log does not retry — callers decide.
   */
  appendRecord(record: DecisionRecord): Promise<void>;

  /**
   * Load all records for one game. Returns null when the gameId has no
   * records on file. Used for cold reads of games not in the hot index.
   */
  loadGame(gameId: string): Promise<DecisionRecord[] | null>;

  /**
   * Release adapter resources. Idempotent. After close, every method
   * rejects with a closed-state error.
   */
  close(): Promise<void>;
}

/**
 * In-memory adapter for tests. Holds records in a `gameId -> records[]`
 * map keyed by insertion order so iteration is deterministic. No IO.
 */
export function createInMemoryStorage(): DecisionStorage {
  const games = new Map<string, DecisionRecord[]>();
  let closed = false;

  const ensureOpen = (op: string): void => {
    if (closed) throw new Error(`DecisionStorage closed (during ${op})`);
  };

  return {
    async hydrate() {
      ensureOpen("hydrate");
      return {
        games: Array.from(games.entries()).map(([gameId, records]) => ({
          gameId,
          records: [...records],
        })),
        warnings: [],
      };
    },

    async appendRecord(record) {
      ensureOpen("appendRecord");
      const list = games.get(record.gameId);
      if (list) {
        list.push(record);
      } else {
        games.set(record.gameId, [record]);
      }
    },

    async loadGame(gameId) {
      ensureOpen("loadGame");
      const list = games.get(gameId);
      return list ? [...list] : null;
    },

    async close() {
      closed = true;
    },
  };
}
