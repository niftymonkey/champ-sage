/**
 * Filter for stale GEP augment offers replayed at app launch.
 *
 * When the app attaches to an already-running League game, GEP replays the
 * most recent `picked_augment` and the offer that preceded it — in that
 * order, milliseconds apart. The offer is stale (player already resolved it)
 * but the app used to treat it as a fresh choice, auto-firing augment
 * coaching and leaving badge overlays stuck "analyzing" for minutes.
 *
 * This filter tracks every augment picked since the filter was last reset
 * (game-exit) and suppresses any offer that contains a previously-picked
 * augment. In ARAM Mayhem / Arena an augment cannot be picked twice, so a
 * match between current offer and prior picks is always a replay.
 */

export interface GepUpdate {
  feature?: string;
  category?: string;
  key?: string;
  value?: string | Record<string, unknown>;
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

export class AugmentReplayFilter {
  private picked = new Set<string>();

  recordPick(name: string): void {
    const normalized = name.trim().toLowerCase();
    if (normalized) this.picked.add(normalized);
  }

  isStaleOffer(names: string[]): boolean {
    return names.some((n) => this.picked.has(n.trim().toLowerCase()));
  }

  reset(): void {
    this.picked.clear();
  }

  /** Test helper. */
  size(): number {
    return this.picked.size;
  }
}
