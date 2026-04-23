/**
 * Filter for stale GEP augment offers replayed at app launch.
 *
 * When the app attaches to an already-running League game, GEP replays the
 * most recent `picked_augment` and the offer that preceded it — in that
 * order, milliseconds apart. The offer is stale (player already resolved it)
 * but the app used to treat it as a fresh choice, auto-firing augment
 * coaching and leaving badge overlays stuck "analyzing" for minutes.
 *
 * Stat shards (e.g., "Attack Damage Shard") complicate this: they CAN be
 * offered and picked multiple times in a single match, so the simple
 * "does this offer contain anything I've already picked?" check false-
 * positives on legitimate repeat shard rounds. The filter therefore uses
 * two rules:
 *
 *   1. Real augments go into a lifetime-tracked `augmentPicks` set. Any
 *      match between an offer and this set is treated as a replay — real
 *      augments cannot recur in one game.
 *   2. Every pick (shard or augment) is recorded with a timestamp in
 *      `lastPick`. An offer is suppressed only if the last pick happened
 *      within `replayWindowMs` (default 1000ms) AND the offer contains
 *      that pick's name. GEP's startup pick+offer replays fire within
 *      milliseconds of each other; normal in-game rounds space the next
 *      offer by seconds, so the window catches replays without false-
 *      positiving legitimate repeat shard offers.
 */

export interface GepUpdate {
  feature?: string;
  category?: string;
  key?: string;
  value?: string | Record<string, unknown>;
}

/** HTML tags occasionally leak into augment name strings ("Armor Penetration Shard<br>"). */
function normalizeName(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .trim()
    .toLowerCase();
}

/**
 * True for stat shard names like "Attack Damage Shard", "Health and Size
 * Shard", "Armor Penetration Shard<br>". Shards have the word "Shard" as
 * the last token (after any stray HTML tags); real augments don't.
 */
function isStatShard(raw: string): boolean {
  return /\bshard\s*$/i.test(raw.replace(/<[^>]*>/g, "").trim());
}

/** Returns the 3 augment names, or null if this update is not an offer. */
export function parseAugmentOfferNames(update: GepUpdate): string[] | null {
  if (update.feature !== "augments" || update.key !== "me") return null;
  let parsed: unknown;
  try {
    parsed =
      typeof update.value === "string"
        ? JSON.parse(update.value)
        : update.value;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as {
    augment_1?: { name?: unknown };
    augment_2?: { name?: unknown };
    augment_3?: { name?: unknown };
  };
  const names = [
    obj.augment_1?.name,
    obj.augment_2?.name,
    obj.augment_3?.name,
  ].filter((n): n is string => typeof n === "string" && n.length > 0);
  return names.length > 0 ? names : null;
}

/** Returns the picked augment name, or null if this update is not a pick. */
export function parseAugmentPickedName(update: GepUpdate): string | null {
  if (update.feature !== "augments" || update.key !== "picked_augment") {
    return null;
  }
  const raw = update.value;
  const name = typeof raw === "string" ? raw.trim() : "";
  return name.length > 0 ? name : null;
}

export interface AugmentReplayFilterOptions {
  /** Defaults to `Date.now`. Tests inject a mock clock. */
  now?: () => number;
  /** Window after a pick during which a matching offer is treated as a replay. */
  replayWindowMs?: number;
}

export class AugmentReplayFilter {
  private augmentPicks = new Set<string>();
  private lastPick: { normalized: string; ts: number } | null = null;
  private readonly now: () => number;
  private readonly replayWindowMs: number;

  constructor(options: AugmentReplayFilterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.replayWindowMs = options.replayWindowMs ?? 1000;
  }

  recordPick(name: string): void {
    const normalized = normalizeName(name);
    if (!normalized) return;
    this.lastPick = { normalized, ts: this.now() };
    // Only real augments (not shards) go into the lifetime set — shards can
    // legitimately recur in later rounds.
    if (!isStatShard(name)) {
      this.augmentPicks.add(normalized);
    }
  }

  isStaleOffer(names: string[]): boolean {
    const normalizedOffer = names.map(normalizeName);
    // Rule 1: any previously-picked real augment in the offer means replay.
    if (normalizedOffer.some((n) => this.augmentPicks.has(n))) {
      return true;
    }
    // Rule 2: offer contains the last pick AND the pick happened inside the
    // GEP replay window. This is the shard-safe check.
    if (
      this.lastPick &&
      this.now() - this.lastPick.ts <= this.replayWindowMs &&
      normalizedOffer.includes(this.lastPick.normalized)
    ) {
      return true;
    }
    return false;
  }

  reset(): void {
    this.augmentPicks.clear();
    this.lastPick = null;
  }

  /** Test helper. */
  size(): number {
    return this.augmentPicks.size;
  }
}
