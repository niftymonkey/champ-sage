/**
 * Corrective-retry orchestration for item recommendations (#117).
 *
 * `enforceRecommendationLegality` guarantees the surfaced options are
 * buyable, but silently deleting an option leaves the answer prose talking
 * about a card that is no longer there. This module gives the model ONE
 * chance to fix its own violations: filter, and if anything dropped, send a
 * corrective message through `session.correctLastAsk` (history-replacing, so
 * the corrective exchange never leaks into later context), then filter the
 * corrected response too. The shipped options are ALWAYS the filtered ones:
 * a shorter buyable list beats an unbuyable recommendation, so a failed or
 * still-violating retry ships filtered output rather than the raw model list.
 */

import type { Recommendation } from "../../types";
import type { Item } from "../../../data-ingest/types";
import type { GameMode } from "../../../mode/types";
import type { MatchSession } from "../../match-session";
import type { CoachingFeature } from "../../feature";
import type { ItemRecInput } from "./index";
import type { ItemRecResult } from "./schema";
import {
  enforceRecommendationLegality,
  type RecommendationDrop,
} from "./legality";
import { getLogger } from "../../../logger";
import { isAbortError } from "../../race-with-retry";

const remediationLog = getLogger("coaching:remediation");

export interface RemediateItemRecOptions {
  session: MatchSession;
  feature: CoachingFeature<ItemRecInput, ItemRecResult>;
  input: ItemRecInput;
  /** The first (already returned) item-rec response to validate. */
  response: ItemRecResult;
  items: ReadonlyMap<number, Item>;
  mode: GameMode;
  ownedItemNames: readonly string[];
  /** Cancels the corrective call along with the request that produced the
   *  first response. */
  signal?: AbortSignal;
}

export interface RemediatedItemRec {
  /** The answer to surface: the corrected response's when the retry
   *  succeeded, the original response's otherwise. */
  answer: string;
  /** The filtered (always buyable) options of whichever response shipped. */
  recommendations: Recommendation[];
  /** Drops from the final filter. Non-empty means the shipped list was
   *  shortened: either the retry still violated, or it failed and the first
   *  response's violations stand. */
  dropped: RecommendationDrop[];
  /** True when the corrective retry succeeded and its response shipped. */
  corrected: boolean;
}

/**
 * Model-facing corrective prose for a set of legality drops. Restates every
 * option it offered by name, states each broken rule in the vocabulary the
 * item-rec task prompt uses (options, restriction groups, boots, mode
 * purchasability, the player's inventory), and asks for a replacement of
 * only the violating options plus an answer field that matches them.
 */
export function buildItemRecCorrectiveMessage(
  rawRecommendations: readonly Recommendation[],
  dropped: readonly RecommendationDrop[]
): string {
  const offered = rawRecommendations.map((r) => r.name).join(", ");
  const violations = dropped.map((drop) => `- ${describeViolation(drop)}`);

  return [
    `Some of the options you recommended cannot be purchased. You offered: ${offered}.`,
    "Problems:",
    ...violations,
    "Return corrected options that replace only the ones named above. Keep the legal options unchanged, and make the answer field describe the options you actually return.",
  ].join("\n");
}

/** One violation as model-facing prose, in the task prompt's vocabulary. */
function describeViolation(drop: RecommendationDrop): string {
  const name = drop.recommendation.name;
  switch (drop.kind) {
    case "already-owned":
      return drop.ownedName === name
        ? `The player already owns ${name}. Buying it again buys nothing.`
        : `${name} is the base item of ${drop.ownedName}, which the player already owns. Buying it again buys nothing.`;
    case "owned-group-collision":
      return `${name} is in the same restriction group ("${drop.group}") as ${drop.ownedName}, which the player already owns. The shop blocks that purchase.`;
    case "owned-boots-collision":
      return `${name} is a second pair of boots; the player already owns ${drop.ownedName}. Only one pair of boots can be owned at a time.`;
    case "duplicate-option":
      return `${name} is listed twice. Every option must be a different item.`;
    case "mode-unavailable":
      return `${name} is not purchasable in ${drop.modeName}.`;
  }
}

/**
 * Validate an item-rec response and retry ONCE through the session when it
 * offers options the player cannot buy. See the module docblock for the
 * policy.
 */
export async function remediateItemRec(
  options: RemediateItemRecOptions
): Promise<RemediatedItemRec> {
  const {
    session,
    feature,
    input,
    response,
    items,
    mode,
    ownedItemNames,
    signal,
  } = options;

  const firstPass = enforceRecommendationLegality(
    response.recommendations,
    items,
    mode,
    ownedItemNames
  );

  if (firstPass.dropped.length === 0) {
    return {
      answer: response.answer,
      recommendations: firstPass.recommendations,
      dropped: [],
      corrected: false,
    };
  }

  const correction = buildItemRecCorrectiveMessage(
    response.recommendations,
    firstPass.dropped
  );

  try {
    const { value: correctedResponse } = await session.correctLastAsk(
      feature,
      input,
      correction,
      { signal }
    );
    const correctedPass = enforceRecommendationLegality(
      correctedResponse.recommendations,
      items,
      mode,
      ownedItemNames
    );
    return {
      answer: correctedResponse.answer,
      recommendations: correctedPass.recommendations,
      dropped: correctedPass.dropped,
      corrected: true,
    };
  } catch (err) {
    // A cancelled request must stay cancelled: CoachingPipeline's callers
    // publish whatever this returns, and only an AbortError reaching them
    // keeps a cancelled answer off the feed and the overlay.
    if (isAbortError(err) || signal?.aborted) throw err;
    remediationLog.warn(
      `Item-rec corrective retry failed (${err}); shipping the first response's filtered options`
    );
    return {
      answer: response.answer,
      recommendations: firstPass.recommendations,
      dropped: firstPass.dropped,
      corrected: false,
    };
  }
}
