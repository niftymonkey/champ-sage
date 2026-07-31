/**
 * Upstream shape comparison for the patch-drift audit.
 *
 * Every guard the ingest pipeline had before this module measured internal
 * consistency: what share of champions resolved abilities, what share of
 * abilities carried scaling. All of them sat at 100% through patch 16.15.1
 * while sixty champions silently carried the wrong ability kits, because 173
 * of 173 champions resolved. They were just the wrong 173.
 *
 * This module measures the opposite thing: does upstream still have the SHAPE
 * we built against. It answers in terms of things that cannot change without
 * someone deciding to change them, namely id namespaces, map ids, queue ids
 * and entity counts. A new game mode cannot ship without moving at least one
 * of those, which is what makes the check worth trusting.
 *
 * The comparison is pure so it can be tested without the network; the fetching
 * lives in `audit-upstream-drift.ts`.
 */

export interface UpstreamShape {
  /** Informational only: never itself a drift finding. */
  ddragonVersion: string;
  /** Total entries in `champion.json`, variants included. */
  championEntries: number;
  /** Entries whose id names a real champion rather than a mode variant. */
  canonicalChampions: number;
  /** Prefixes of variant champion ids, e.g. `["Jade"]` for `Jade_Ashe`. */
  variantPrefixes: string[];
  /** Item id namespace (leading digit pair, or `base`) to entry count. */
  itemNamespaces: Record<string, number>;
  /** Every map id any item is purchasable on, ascending. */
  itemMapIds: number[];
  /** CommunityDragon map id to display name. */
  maps: Record<string, string>;
  /** CommunityDragon queue id to display name. */
  queues: Record<string, string>;
}

export type DriftKind =
  | "champion-variant-prefix"
  | "item-namespace"
  | "map-id"
  | "queue"
  | "count";

export interface DriftFinding {
  kind: DriftKind;
  detail: string;
}

/**
 * Diff an observed upstream shape against the committed baseline.
 *
 * Counts are compared exactly rather than with a tolerance. A tolerance would
 * have to be wide enough to absorb a normal champion release, which is already
 * wider than the signal worth catching, and the audit is meant to be run at
 * patch boundaries and reviewed, then the baseline updated deliberately. The
 * friction is the feature.
 */
export function compareUpstreamShape(
  baseline: UpstreamShape,
  observed: UpstreamShape
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const prefix of added(
    baseline.variantPrefixes,
    observed.variantPrefixes
  )) {
    findings.push({
      kind: "champion-variant-prefix",
      detail: `New champion id prefix "${prefix}_". A mode-specific roster shipped: check whether its entries collide with canonical champion names.`,
    });
  }

  for (const namespace of added(
    Object.keys(baseline.itemNamespaces),
    Object.keys(observed.itemNamespaces)
  )) {
    findings.push({
      kind: "item-namespace",
      detail: `New item id namespace "${namespace}xxxx" with ${observed.itemNamespaces[namespace]} entries. A mode with its own shop shipped: classifyItemMode treats unknown namespaces as "other" and hides them from every catalog.`,
    });
  }

  const mapIds = symmetricDifference(
    baseline.itemMapIds.map(String),
    observed.itemMapIds.map(String)
  );
  for (const mapId of mapIds.added) {
    const name = observed.maps[mapId] ?? "unnamed";
    findings.push({
      kind: "map-id",
      detail: `New map id ${mapId} ("${name}") carries purchasable items. Check MAP_TO_MODE and any per-mode allowed-map set.`,
    });
  }
  for (const mapId of mapIds.removed) {
    findings.push({
      kind: "map-id",
      detail: `Map id ${mapId} no longer carries any purchasable items. A mode may have been retired.`,
    });
  }

  for (const queueId of added(
    Object.keys(baseline.queues),
    Object.keys(observed.queues)
  )) {
    findings.push({
      kind: "queue",
      detail: `New queue ${queueId}: "${observed.queues[queueId]}". The queue name is usually the first readable description of a mode we do not model yet.`,
    });
  }

  if (baseline.championEntries !== observed.championEntries) {
    findings.push({
      kind: "count",
      detail: `champion.json entries ${baseline.championEntries} -> ${observed.championEntries}.`,
    });
  }

  for (const [namespace, count] of Object.entries(baseline.itemNamespaces)) {
    const now = observed.itemNamespaces[namespace];
    if (now === undefined) {
      findings.push({
        kind: "count",
        detail: `Item namespace "${namespace}" disappeared (was ${count} entries).`,
      });
    } else if (now !== count) {
      findings.push({
        kind: "count",
        detail: `Item namespace "${namespace}" ${count} -> ${now} entries.`,
      });
    }
  }

  return findings;
}

function added(baseline: string[], observed: string[]): string[] {
  const known = new Set(baseline);
  return observed.filter((value) => !known.has(value));
}

function symmetricDifference(
  baseline: string[],
  observed: string[]
): { added: string[]; removed: string[] } {
  const before = new Set(baseline);
  const after = new Set(observed);
  return {
    added: observed.filter((value) => !before.has(value)),
    removed: baseline.filter((value) => !after.has(value)),
  };
}

interface RawChampionPayload {
  data: Record<string, { id: string }>;
}

interface RawItemPayload {
  data: Record<string, { maps?: Record<string, boolean> }>;
}

/**
 * Count champion entries and name any variant id scheme present.
 *
 * Mirrors `isVariantChampionId` in the ingest source: Riot has never used `_`
 * in a canonical champion id, so the separator identifies mode variants.
 */
export function summarizeChampions(
  payload: unknown
): Pick<
  UpstreamShape,
  "championEntries" | "canonicalChampions" | "variantPrefixes"
> {
  const entries = Object.values((payload as RawChampionPayload).data);
  const prefixes = new Set<string>();
  let canonical = 0;

  for (const entry of entries) {
    const separator = entry.id.indexOf("_");
    if (separator === -1) canonical++;
    else prefixes.add(entry.id.slice(0, separator));
  }

  return {
    championEntries: entries.length,
    canonicalChampions: canonical,
    variantPrefixes: [...prefixes].sort(),
  };
}

/**
 * Bucket item ids by namespace and collect every map id items are sold on.
 *
 * Ids below 100000 are the historic shared pool (`base`); everything above is
 * namespaced by its leading digit pair, which is how Riot has introduced each
 * mode-specific shop so far (22 Arena, 32 ARAM, 44 Arena prismatics, 77 Jade).
 */
export function summarizeItems(
  payload: unknown
): Pick<UpstreamShape, "itemNamespaces" | "itemMapIds"> {
  const namespaces: Record<string, number> = {};
  const mapIds = new Set<number>();

  for (const [id, entry] of Object.entries((payload as RawItemPayload).data)) {
    const numeric = Number(id);
    const namespace = numeric < 100000 ? "base" : id.slice(0, 2);
    namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;

    for (const [mapId, available] of Object.entries(entry.maps ?? {})) {
      if (available) mapIds.add(Number(mapId));
    }
  }

  return {
    itemNamespaces: namespaces,
    itemMapIds: [...mapIds].sort((a, b) => a - b),
  };
}
