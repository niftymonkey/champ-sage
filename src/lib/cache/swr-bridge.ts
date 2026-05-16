import type { ScopedMutator } from "swr";
import { getLogger } from "../logger";

const log = getLogger("swr-bridge");

/**
 * Bridges SWR's React-scoped `mutate` to the module-level engine layer.
 *
 * `<SWRConfig provider={localStorageProvider}>` creates a *scoped* cache;
 * SWR's package-level `mutate` only reaches the default (unscoped) cache,
 * which is the wrong target. Non-React code (RxJS subscriptions in
 * `MatchHistoryStore`, future stores) calls `invalidateKey(...)` to
 * trigger revalidation; a small `<SWRBridge />` component inside the
 * SWRConfig registers the scoped mutator via `useSWRConfig().mutate`.
 *
 * Invalidations issued before the bridge mounts (e.g. an LCU credentials
 * BehaviorSubject emitting its current value during store construction,
 * which happens during a render before effects fire) are queued and
 * drained when the bridge registers.
 */

let scopedMutate: ScopedMutator | null = null;
const pendingKeys = new Set<string>();

export function setScopedMutate(mutate: ScopedMutator): void {
  scopedMutate = mutate;
  log.debug(
    `Scoped mutate registered; draining ${pendingKeys.size} pending key(s)`,
  );
  if (pendingKeys.size === 0) return;
  for (const key of pendingKeys) void mutate(key);
  pendingKeys.clear();
}

export function invalidateKey(key: string): void {
  if (scopedMutate !== null) {
    log.debug(`invalidateKey ${key} → calling scoped mutate`);
    void scopedMutate(key);
  } else {
    log.debug(`invalidateKey ${key} → bridge not ready, queueing`);
    pendingKeys.add(key);
  }
}
