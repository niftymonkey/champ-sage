/**
 * Corrective-retry orchestration for game-plan build paths (#117 slice 5).
 *
 * The legality sweep (`enforceBuildPathLegality`) guarantees the surfaced
 * plan is legal, but silently shortening a 6-item plan costs the player a
 * slot. This module gives the model ONE chance to fix its own violations:
 * sweep, and if anything dropped, send a corrective message through
 * `session.correctLastAsk` (history-replacing, so the corrective exchange
 * never leaks into later context), then sweep the corrected response too.
 * The returned buildPath is ALWAYS the swept (legal) one: a shorter legal
 * path beats an illegal 6-item path, so a failed or still-violating retry
 * ships swept output rather than the raw model path.
 */

import type { BuildPathItem } from "../../types";
import type { Item } from "../../../data-ingest/types";
import type { GameMode } from "../../../mode/types";
import type { MatchSession } from "../../match-session";
import type { CoachingFeature } from "../../feature";
import type { GamePlanResult } from "./schema";
import {
  enforceBuildPathLegality,
  extractBuildPath,
  type BuildPathDrop,
  type GamePlanInput,
} from "./index";
import { getLogger } from "../../../logger";

const remediationLog = getLogger("coaching:remediation");

export interface RemediateGamePlanOptions {
  session: MatchSession;
  feature: CoachingFeature<GamePlanInput, GamePlanResult>;
  input: GamePlanInput;
  /** The first (already returned) game-plan response to validate. */
  response: GamePlanResult;
  items: ReadonlyMap<number, Item>;
  mode: GameMode;
  ownedItemNames: readonly string[];
}

export interface RemediatedGamePlan {
  /** The answer to surface: the corrected response's when the retry
   *  succeeded, the original response's otherwise. */
  answer: string;
  /** The swept (always legal) build path of whichever response shipped. */
  buildPath: BuildPathItem[];
  /** Drops from the final sweep. Non-empty means the shipped path was
   *  shortened: either the retry still violated, or it failed and the
   *  first response's violations stand. */
  dropped: BuildPathDrop[];
  /** True when the corrective retry succeeded and its response shipped. */
  corrected: boolean;
}

/**
 * Model-facing corrective prose for a set of legality drops. Restates the
 * full offending path by name, states each broken rule in the same
 * vocabulary the task prompt uses (restriction groups, at most one Boots
 * item, mode purchasability, duplicates, owned items), and instructs the
 * model to return a corrected complete plan.
 */
export function buildCorrectiveMessage(
  rawBuildPath: readonly BuildPathItem[],
  dropped: readonly BuildPathDrop[]
): string {
  const pathNames = rawBuildPath.map((e) => e.name).join(", ");
  const violations = dropped.map((drop) => `- ${describeViolation(drop)}`);

  return [
    `Your build path breaks purchase-legality rules. You returned: ${pathNames}.`,
    "Violations:",
    ...violations,
    "Return a corrected complete game plan that obeys every build path rule. Keep the legal entries unchanged and replace only the violating items.",
  ].join("\n");
}

/** One violation as model-facing prose, in the task prompt's vocabulary. */
function describeViolation(drop: BuildPathDrop): string {
  switch (drop.kind) {
    case "duplicate-name":
      return `${drop.entry.name} is listed twice. Never list the same item name twice.`;
    case "mutex-collision":
      return drop.keptSource === "inventory"
        ? `${drop.entry.name} is in the same restriction group ("${drop.group}") as ${drop.keptName}, which the player already owns. The shop blocks that purchase.`
        : `${drop.entry.name} is in the same restriction group ("${drop.group}") as ${drop.keptName}. The build path must never contain two items from the same restriction group.`;
    case "mode-unavailable":
      return `${drop.entry.name} is not purchasable in ${drop.modeName}.`;
    case "boots-collision":
      return drop.keptSource === "inventory"
        ? `${drop.entry.name} is a second Boots item; the player already owns ${drop.keptName}. The build path must contain at most one Boots item.`
        : `${drop.entry.name} is a second Boots item alongside ${drop.keptName}. The build path must contain at most one Boots item.`;
  }
}

/**
 * Validate a game-plan response and retry ONCE through the session when it
 * violates build-path legality. See the module docblock for the policy.
 */
export async function remediateGamePlan(
  options: RemediateGamePlanOptions
): Promise<RemediatedGamePlan> {
  const { session, feature, input, response, items, mode, ownedItemNames } =
    options;

  const rawBuildPath = extractBuildPath(response);
  const firstSweep = enforceBuildPathLegality(
    rawBuildPath,
    items,
    mode,
    ownedItemNames
  );

  if (firstSweep.dropped.length === 0) {
    return {
      answer: response.answer,
      buildPath: firstSweep.buildPath,
      dropped: [],
      corrected: false,
    };
  }

  const correction = buildCorrectiveMessage(rawBuildPath, firstSweep.dropped);

  try {
    const { value: correctedResponse } = await session.correctLastAsk(
      feature,
      input,
      correction
    );
    const correctedSweep = enforceBuildPathLegality(
      extractBuildPath(correctedResponse),
      items,
      mode,
      ownedItemNames
    );
    return {
      answer: correctedResponse.answer,
      buildPath: correctedSweep.buildPath,
      dropped: correctedSweep.dropped,
      corrected: true,
    };
  } catch (err) {
    remediationLog.warn(
      `Corrective retry failed (${err}); shipping the first response's swept path`
    );
    return {
      answer: response.answer,
      buildPath: firstSweep.buildPath,
      dropped: firstSweep.dropped,
      corrected: false,
    };
  }
}
