import type {
  DecisionInput,
  DecisionQuery,
  DecisionRecord,
  RecoveryWarning,
} from "../../src/lib/decision-log/types";
import type { DecisionStorage } from "./storage";

export interface CoachDecisionLog {
  append(input: DecisionInput): Promise<DecisionRecord>;
  query(q: DecisionQuery): Promise<DecisionRecord[]>;
  warnings(): RecoveryWarning[];
  close(): Promise<void>;
}

export interface CoachDecisionLogConfig {
  storage: DecisionStorage;
  clock: () => number;
  idGen: () => string;
}

/**
 * Construct a coach-decision-log handle bound to the given storage,
 * clock, and id generator. Hydrates the in-memory game index from
 * storage before resolving so the handle is ready to serve queries
 * synchronously after the await.
 *
 * Internally maintains an ordered list of gameIds (most-recently-touched
 * last) plus a map of records per game; both serve every query without
 * touching storage past hydration. Append serializes through a single
 * promise chain so concurrent calls produce records in invocation order.
 */
export async function createCoachDecisionLog(
  config: CoachDecisionLogConfig
): Promise<CoachDecisionLog> {
  const { storage, clock, idGen } = config;

  const gameOrder: string[] = [];
  const recordsByGame = new Map<string, DecisionRecord[]>();
  let warnings: RecoveryWarning[] = [];
  let closed = false;
  let appendChain: Promise<unknown> = Promise.resolve();

  const hydration = await storage.hydrate();
  warnings = hydration.warnings;
  for (const game of hydration.games) {
    gameOrder.push(game.gameId);
    recordsByGame.set(game.gameId, [...game.records]);
  }

  const ensureOpen = (op: string): void => {
    if (closed) throw new Error(`CoachDecisionLog closed (during ${op})`);
  };

  const touchGame = (gameId: string): void => {
    const existing = gameOrder.indexOf(gameId);
    if (existing !== -1) gameOrder.splice(existing, 1);
    gameOrder.push(gameId);
  };

  const buildRecord = (input: DecisionInput): DecisionRecord => {
    const envelope = {
      id: idGen(),
      sentAt: clock(),
      schemaVersion: 1 as const,
    };
    return { ...input, ...envelope } as DecisionRecord;
  };

  const doAppend = async (input: DecisionInput): Promise<DecisionRecord> => {
    ensureOpen("append");
    const record = buildRecord(input);
    await storage.appendRecord(record);
    const list = recordsByGame.get(record.gameId);
    if (list) {
      list.push(record);
    } else {
      recordsByGame.set(record.gameId, [record]);
    }
    touchGame(record.gameId);
    return record;
  };

  return {
    async append(input) {
      ensureOpen("append");
      const next = appendChain.then(() => doAppend(input));
      appendChain = next.catch(() => undefined);
      return next;
    },

    async query(q) {
      ensureOpen("query");
      switch (q.kind) {
        case "by-game": {
          const list = recordsByGame.get(q.gameId);
          return list ? [...list] : [];
        }

        case "last-game": {
          if (gameOrder.length === 0) return [];
          const lastGameId = gameOrder[gameOrder.length - 1];
          const list = recordsByGame.get(lastGameId);
          return list ? [...list] : [];
        }

        case "recent-games": {
          if (q.n <= 0) return [];
          const ids = gameOrder.slice(-q.n);
          const out: DecisionRecord[] = [];
          for (const id of ids) {
            const list = recordsByGame.get(id);
            if (list) out.push(...list);
          }
          return out;
        }

        case "by-source": {
          const list = recordsByGame.get(q.gameId);
          if (!list) return [];
          return list.filter((r) => r.source === q.source);
        }
      }
    },

    warnings() {
      return [...warnings];
    },

    async close() {
      if (closed) return;
      closed = true;
      try {
        await appendChain;
      } catch {
        // append errors already surfaced to their callers
      }
      await storage.close();
    },
  };
}
