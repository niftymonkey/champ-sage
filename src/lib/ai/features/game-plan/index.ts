import type { CoachingFeature } from "../../feature";
import type { BuildPathItem } from "../../types";
import type { LoadedGameData } from "../../../data-ingest";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
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
 * Two design constraints shape the pattern:
 *
 * 1. **Start-anchored.** Coaching questions that mention "plan" start with
 *    wh-words or auxiliaries ("what's the plan for dragon", "should I update
 *    my plan", "is my plan working"). Imperative commands start with the verb
 *    (optionally after narrow filler like "please" / "hey" / "coach"). The
 *    `^` anchor rejects the question forms without losing command coverage.
 * 2. **Verb-gated, excluding "new".** Requires both a command verb AND "plan"
 *    in close proximity — bare "plan" appears too naturally in coaching
 *    dialogue to trigger on. "new" was considered and rejected: `"my new
 *    plan is to split push"` and `"that's a new plan"` are commentary, not
 *    commands.
 */
const UPDATE_PLAN_PATTERN =
  /^(?:(?:please|hey|ok|okay|coach)\s+)*(update|refresh|rework|redo|replace|remake)\s+(?:the\s+|my\s+)?(?:game\s+)?plan\b/i;

export function isUpdatePlanCommand(text: string): boolean {
  return UPDATE_PLAN_PATTERN.test(text.trim());
}

/**
 * Factory for the game-plan feature. Binds the output schema to the
 * player's current item catalog so `buildPath[].name` is restricted by
 * OpenAI's strict-mode validator to valid item names only — the structural
 * fix for #109 augment-name-into-buildPath leakage.
 */
export function createGamePlanFeature(
  gameData: LoadedGameData
): CoachingFeature<GamePlanInput, GamePlanResult> {
  const itemNames = Array.from(gameData.items.values()).map((i) => i.name);
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
 * Normalize a game-plan result's build path. Today the schema requires
 * exactly 6 items and enum-locks names to the catalog; `extractBuildPath`
 * preserves the historical fallback of promoting recommendations when
 * `buildPath` somehow comes back empty (degraded mode when enum can't be
 * applied due to size, or legacy compatibility with the old shared-schema
 * response shape).
 */
export function extractBuildPath(
  result: { buildPath?: BuildPathItem[] | null } & {
    recommendations?: Array<{ name: string; reasoning: string }>;
  }
): BuildPathItem[] {
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
