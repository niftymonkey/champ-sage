import type { CoachingFeature } from "../../feature";
import type { BuildPathItem, CoachingResponse } from "../../types";
import { coachingResponseSchema } from "../../schemas";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { GAME_PLAN_TASK_PROMPT } from "./prompt";

export interface GamePlanInput {
  readonly snapshot: GameSnapshot | null;
}

/**
 * The game-plan user message.
 *
 * State-agnostic by design: the same prompt serves the auto-fired opening
 * plan AND the mid-game "update plan" voice command. The [Game State] block
 * that precedes this message carries every temporal input the LLM needs
 * (current items, game time, enemy itemization, KDA). If the LLM needs to
 * revise vs. draft from scratch, that conclusion is driven by what it sees
 * in the snapshot — not by a "this is the start of the game" / "this is
 * mid-game" anchor in the prompt.
 *
 * Instructs the LLM to return its 6-item build path in the structured
 * `buildPath` field with per-item category + reason (not in
 * `recommendations`), so the UI can render category icons and
 * counter-target associations (#99).
 */
export function buildGamePlanQuestion(): string {
  return [
    "Based on the current game state — my champion, current inventory, the enemy team composition and their itemization, my chosen augments, and the game mode — give me my game plan: what to watch out for, who to focus, and my recommended 6-item build path in order. If the state shows items already built, factor them in and keep recommending from the remaining slots so the full 6-item path still reflects the end-state build.",
    "",
    "Return the 6 items in the `buildPath` field of your response (not in `recommendations`). For each item:",
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
 * Pull the structured build path out of a coaching response.
 *
 * Prefers the `buildPath` field. When absent (older prompt formats or a
 * malformed retry response), promotes each recommendation to a build-path
 * item so the UI still renders something usable instead of an empty panel.
 */
export function extractBuildPath(response: CoachingResponse): BuildPathItem[] {
  if (response.buildPath && response.buildPath.length > 0) {
    return response.buildPath;
  }
  return response.recommendations.map((r) => ({
    name: r.name,
    category: "core" as const,
    targetEnemy: null,
    reason: r.reasoning,
  }));
}

export const gamePlanFeature: CoachingFeature<GamePlanInput, CoachingResponse> =
  {
    id: "game-plan",
    supportedPhases: ["in-game"] as const,

    buildTaskPrompt: () => `\n\n${GAME_PLAN_TASK_PROMPT}`,

    buildUserMessage: ({ snapshot }) => {
      const snapshotText = snapshot
        ? formatStateSnapshot(snapshot, { omitAugments: true })
        : "";
      return `[Game State]\n${snapshotText}\n\n[Question]\n${buildGamePlanQuestion()}`;
    },

    outputSchema: coachingResponseSchema,

    extractResult: (raw, meta) =>
      meta.retried ? { ...raw, retried: true } : raw,
  };
