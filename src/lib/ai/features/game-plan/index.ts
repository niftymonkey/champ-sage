import type { CoachingFeature } from "../../feature";
import type { BuildPathItem } from "../../types";
import type { LoadedGameData } from "../../../data-ingest";
import type { Item } from "../../../data-ingest/types";
import type { GameMode } from "../../../mode/types";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { isBuildPathEligible } from "../../item-catalog";
import { GAME_PLAN_TASK_PROMPT } from "./prompt";
import { createGamePlanSchema, type GamePlanResult } from "./schema";

export type { GamePlanResult } from "./schema";

export interface GamePlanInput {
  readonly snapshot: GameSnapshot | null;
}

/**
 * The game-plan user message.
 *
 * State-agnostic by design: the same prompt serves the auto-fired opening
 * plan AND the mid-game "update plan" voice command. The [Game State] block
 * that precedes this message carries every temporal input the LLM needs
 * (current items, game time, enemy itemization, KDA).
 *
 * Instructs the LLM to return its 6-item build path in the structured
 * `buildPath` field with per-item category + reason (not in
 * `recommendations`), so the UI can render category icons and
 * counter-target associations (#99).
 */
export function buildGamePlanQuestion(): string {
  return [
    "Based on the current game state — my champion, current inventory, the enemy team composition and their itemization, my chosen augments, and the game mode — give me my game plan: what to watch out for, who to focus, and my recommended 6-item build path in order.",
    "",
    "The 6-item buildPath represents my END-STATE inventory. Items I already own MUST appear in the buildPath using their exact name from the Item Catalog, in the position they belong in the end-state build. Recommend new items only for the slots that aren't already filled by what I own. Never suggest a 7th item — the inventory cap is 6 total, including items I already have.",
    "",
    "Return the 6 items in the `buildPath` field of your response. For each item:",
    "- name: exact item name from the Item Catalog.",
    "- category: one of core | counter | defensive | damage | utility | situational.",
    "- targetEnemy: the enemy champion name being countered when category is `counter`; set to `null` for every other category (the field must always be present — the schema is nullable, not optional).",
    "- reason: a few words max. Sacrifice grammar for brevity. No full sentences.",
    "",
    "Category definitions:",
    "- core: fundamental to the champion's kit; built regardless of matchup.",
    "- counter: directly addresses one specific enemy champion's threat.",
    "- defensive: survivability against the enemy comp broadly (not one specific champion).",
    "- damage: amplifies damage beyond core items.",
    "- utility: team support, CC, healing, or vision.",
    "- situational: escape hatch for anything that doesn't fit the others. Use rarely.",
  ].join("\n");
}

/**
 * Voice-command trigger for mid-game plan refresh.
 *
 * Detection is intent-based, not start-anchored. Players phrase the command
 * naturally and mid-sentence ("you should update the game plan", "these are
 * wrong, update the plan", "I think you should update gameplay"), so the old
 * `^`-anchored matcher silently dropped real commands. Two parts:
 *
 * 1. **Command, matched anywhere.** A command verb (update / refresh / rework /
 *    redo / replace / remake, plus their `-ing` forms) followed by an optional
 *    article and the plan target. "plan", "game plan", Whisper's one-word
 *    "gameplan" (`game\s*plan`), and its mishearing "gameplay" all count. Bare
 *    "plan" without a command verb stays inert, so commentary like "that's a
 *    new plan" or "the plan is working" does not fire.
 * 2. **Deliberative guard.** Reject self-directed questions where the player is
 *    weighing whether to update rather than commanding it ("should I update my
 *    plan?", "do you think I should update the plan?"). These must fall through
 *    to a coaching answer instead of silently regenerating the plan. The guard
 *    keys on a first-person subject ("should I", "do we", "I should"), so
 *    coach-directed requests ("you should update...", "can you update...") still
 *    fire.
 *
 * Known limitation: embedded negation ("don't update the plan", "I don't think
 * you should") is not detected and will fire. It is rare in live voice;
 * detecting it robustly is the intent-classifier path we deliberately skipped.
 */
const UPDATE_VERB =
  "(?:update|updating|refresh|refreshing|rework|reworking|redo|redoing|replace|replacing|remake|remaking)";

const UPDATE_PLAN_COMMAND = new RegExp(
  `\\b${UPDATE_VERB}\\s+(?:(?:the|my|our|your)\\s+)?(?:game\\s*)?(?:plan|gameplay)\\b`,
  "i"
);

const DELIBERATIVE_QUESTION =
  /\b(?:should|shall|can|could|would|will|do|does|did)\s+(?:i|we)\b|\b(?:i|we)\s+should\b/i;

export function isUpdatePlanCommand(text: string): boolean {
  const trimmed = text.trim();
  if (DELIBERATIVE_QUESTION.test(trimmed)) return false;
  return UPDATE_PLAN_COMMAND.test(trimmed);
}

/**
 * Factory for the game-plan feature. Binds the output schema's `buildPath[].name`
 * enum to the items that are build-path-eligible in the current mode, via the
 * shared `isBuildPathEligible` predicate (completed, purchasable, non-consumable,
 * mode-available). This re-enables name validation (#109) and structurally rules
 * out consumables and off-catalog entries (#127).
 *
 * Two things this deliberately does NOT do, because they are not expressible as
 * a per-element enum and belong to post-hoc validation (#117): cross-item
 * legality (one boots, no duplicate Legendary, mutually exclusive item groups)
 * and excluding items the player already owns.
 *
 * Why not the raw catalog or `filterItemsByMode`: the full catalog (~648 items)
 * exceeds the schema's 500-value enum cap and silently disables the enum, while
 * `filterItemsByMode(items, "aram")` returns only the ~21 ARAM-exclusive
 * variants (ID-range partition, not "usable in ARAM") and cornered the model
 * into a Winter's Approach x6 build. `isBuildPathEligible` accepts standard plus
 * ARAM-variant items, ~150-200 names, comfortably under the cap.
 */
export function createGamePlanFeature(
  gameData: LoadedGameData,
  mode: GameMode
): CoachingFeature<GamePlanInput, GamePlanResult> {
  // Dedupe by name: in ARAM a standard item and its ARAM variant are both
  // eligible and share a name, so the raw list carries ~21 duplicate names.
  const itemNames = [
    ...new Set(
      Array.from(gameData.items.values())
        .filter((item) => isBuildPathEligible(item, mode))
        .map((i) => i.name)
    ),
  ];
  const schema = createGamePlanSchema(itemNames);

  return {
    id: "game-plan",
    supportedPhases: ["in-game"] as const,

    buildTaskPrompt: () => `\n\n${GAME_PLAN_TASK_PROMPT}`,

    buildUserMessage: ({ snapshot }) => {
      const snapshotText = snapshot
        ? formatStateSnapshot(snapshot, { omitAugments: true })
        : "";
      return `[Game State]\n${snapshotText}\n\n[Question]\n${buildGamePlanQuestion()}`;
    },

    outputSchema: schema,

    extractResult: (raw) => raw,

    summarizeForHistory: (result) => result.answer,
  };
}

/**
 * Permissive shape for `extractBuildPath` callers.
 *
 * The current schema produces `GamePlanResult` directly, but this helper
 * also accepts the legacy `CoachingResponse` shape where `buildPath` is
 * nullable and the model occasionally placed items in `recommendations`
 * instead. Both fields are optional so either source can satisfy it.
 */
export interface GamePlanResultLike {
  buildPath?: BuildPathItem[] | null;
  recommendations?: Array<{ name: string; reasoning: string }>;
}

/**
 * Normalize a game-plan result's build path. Today the schema requires
 * exactly 6 items and enum-locks names to the catalog; `extractBuildPath`
 * preserves the historical fallback of promoting recommendations when
 * `buildPath` somehow comes back empty (degraded mode when enum can't be
 * applied due to size, or legacy compatibility with the old shared-schema
 * response shape).
 */
export function extractBuildPath(result: GamePlanResultLike): BuildPathItem[] {
  if (result.buildPath && result.buildPath.length > 0) {
    return result.buildPath;
  }
  return (result.recommendations ?? []).map((r) => ({
    name: r.name,
    category: "core" as const,
    targetEnemy: null,
    reason: r.reasoning,
  }));
}

/**
 * Post-hoc validator for the boots-uniqueness rule (#109).
 *
 * Schema enums can't express "at most one Boots-tagged value" — the name
 * enum permits each pair of boots individually, and uniqueness across
 * elements isn't a constraint JSON Schema models. The prompt carries the
 * primary rule; this helper is a belt-and-suspenders detector that lets the
 * pipeline log a warning when the LLM slips up.
 *
 * Returns every build-path entry whose name matches a Boots-tagged item,
 * but only when two or more are present. A single pair is the expected case
 * and returns an empty array. Unknown names (not in the catalog) are
 * ignored — the schema enum already rejects most off-catalog leakage.
 */
export function findDuplicateBoots(
  buildPath: readonly BuildPathItem[],
  items: ReadonlyMap<number, Item>
): BuildPathItem[] {
  const bootsNames = new Set<string>();
  for (const item of items.values()) {
    if (item.tags.includes("Boots")) {
      bootsNames.add(item.name);
    }
  }
  const boots = buildPath.filter((entry) => bootsNames.has(entry.name));
  return boots.length > 1 ? boots : [];
}
