/**
 * Compares the augment roster of two patchlines (typically live vs PBE) for a
 * single mode and reports what changed, framed around what the production
 * ingest would actually do with the candidate data.
 *
 * Pure: all network I/O happens in the caller (the eval script), which passes
 * already-fetched data in. That keeps this module deterministic and trivially
 * testable, and lets the same report later back an in-app readiness view.
 *
 * The "dropped" and "coverage" fields track CDragon augments with no matching
 * wiki entry. Production no longer discards those: Mayhem keeps them with a
 * placeholder description (see `community-dragon.ts`) so they stay visible to
 * the player and coaching LLM before the wiki catches up. This report still
 * surfaces them as the description-gap signal that drives readiness, not as
 * augments that vanish from ingest.
 */
import type { Augment, AugmentMode } from "./types";
import {
  classifyAugmentMode,
  normalizeForMatch,
  type RawCDragonAugment,
} from "./sources/community-dragon";

export interface AugmentChange {
  id: number;
  name: string;
  rarity: string;
}

export interface RarityChange {
  id: number;
  name: string;
  from: string;
  to: string;
}

export interface AugmentPatchlineReport {
  mode: AugmentMode;
  baseCount: number;
  candidateCount: number;
  /** Candidate augments whose id is absent from the base roster. */
  addedById: AugmentChange[];
  /** Candidate augments whose (normalized) name is absent from the base roster. */
  addedByName: AugmentChange[];
  /** Base augments whose id is absent from the candidate roster. */
  removed: AugmentChange[];
  /** Augments present (by name) in both rosters whose rarity differs. */
  rarityChanged: RarityChange[];
  /**
   * Candidate augments with no wiki match, deduped by name. Production now keeps
   * Mayhem ones with a placeholder rather than dropping them; the field name
   * reflects this report's readiness framing (wiki text still missing), not the
   * live-ingest outcome. Includes gaps that already exist on the base patchline,
   * so this is the full picture, not just the PBE-introduced regression.
   */
  droppedForMissingDescription: AugmentChange[];
  /**
   * The PBE-introduced description gap: augments new to the candidate (by name)
   * that have no wiki description yet. This is the readiness number that tracks
   * what PBE adds, excluding gaps that already exist on the base patchline.
   */
  addedMissingWiki: AugmentChange[];
  /** How many candidate augments have a usable wiki description today. */
  wikiCoverage: { described: number; total: number };
  grouping: {
    /** Wiki augments (of this mode) that still carry set membership. */
    wikiSetMembershipCount: number;
    /**
     * Known hardcoded set names that appear as individual candidate augments
     * but are not base augments. A non-empty list is the fingerprint of the
     * set-grouping mechanic being dismantled into standalone augments.
     */
    repurposedSetNames: string[];
  };
}

export interface AugmentPatchlineReportInput {
  base: RawCDragonAugment[];
  candidate: RawCDragonAugment[];
  /** Wiki augments for `mode`, keyed by lowercased name, carrying `sets[]`. */
  wikiAugments: Map<string, Augment>;
  /** Hardcoded set names (e.g. from `getMayhemAugmentSets()`). */
  knownSetNames: string[];
  /** Mode to compare. Defaults to "mayhem". */
  mode?: AugmentMode;
}

function toChange(a: RawCDragonAugment): AugmentChange {
  return { id: a.id, name: a.nameTRA, rarity: a.rarity };
}

/** Keep the first entry per normalized name. CDragon can carry duplicate names. */
function dedupeByName(list: AugmentChange[]): AugmentChange[] {
  const seen = new Set<string>();
  const out: AugmentChange[] = [];
  for (const a of list) {
    const key = normalizeForMatch(a.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function buildAugmentPatchlineReport(
  input: AugmentPatchlineReportInput
): AugmentPatchlineReport {
  const mode = input.mode ?? "mayhem";
  const ofMode = (list: RawCDragonAugment[]) =>
    list.filter((a) => classifyAugmentMode(a.augmentSmallIconPath) === mode);

  const base = ofMode(input.base);
  const candidate = ofMode(input.candidate);

  const baseIds = new Set(base.map((a) => a.id));
  const candidateIds = new Set(candidate.map((a) => a.id));
  const baseNames = new Set(base.map((a) => normalizeForMatch(a.nameTRA)));

  // Mirror the production merge: an augment is kept only if its normalized name
  // matches a wiki entry; otherwise it has no description and is discarded.
  const wikiNames = new Set(
    [...input.wikiAugments.keys()].map((k) => normalizeForMatch(k))
  );
  const hasWiki = (a: RawCDragonAugment) =>
    wikiNames.has(normalizeForMatch(a.nameTRA));

  const baseRarityByName = new Map<string, string>();
  for (const a of base)
    baseRarityByName.set(normalizeForMatch(a.nameTRA), a.rarity);

  const rarityChanged: RarityChange[] = [];
  for (const a of candidate) {
    const key = normalizeForMatch(a.nameTRA);
    const from = baseRarityByName.get(key);
    if (from !== undefined && from !== a.rarity) {
      rarityChanged.push({ id: a.id, name: a.nameTRA, from, to: a.rarity });
    }
  }

  const dropped = dedupeByName(
    candidate.filter((a) => !hasWiki(a)).map(toChange)
  );

  const addedByName = dedupeByName(
    candidate
      .filter((a) => !baseNames.has(normalizeForMatch(a.nameTRA)))
      .map(toChange)
  );
  const addedMissingWiki = addedByName.filter(
    (a) => !wikiNames.has(normalizeForMatch(a.name))
  );

  const candidateNames = new Set(
    candidate.map((a) => normalizeForMatch(a.nameTRA))
  );
  const repurposedSetNames = input.knownSetNames.filter((s) => {
    const n = normalizeForMatch(s);
    return candidateNames.has(n) && !baseNames.has(n);
  });

  let wikiSetMembershipCount = 0;
  for (const a of input.wikiAugments.values()) {
    if (a.sets.length > 0) wikiSetMembershipCount += 1;
  }

  return {
    mode,
    baseCount: base.length,
    candidateCount: candidate.length,
    addedById: candidate.filter((a) => !baseIds.has(a.id)).map(toChange),
    addedByName,
    removed: base.filter((a) => !candidateIds.has(a.id)).map(toChange),
    rarityChanged,
    droppedForMissingDescription: dropped,
    addedMissingWiki,
    wikiCoverage: {
      described: candidate.filter((a) => hasWiki(a)).length,
      total: candidate.length,
    },
    grouping: { wikiSetMembershipCount, repurposedSetNames },
  };
}
