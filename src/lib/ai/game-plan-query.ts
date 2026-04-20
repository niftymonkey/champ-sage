import type { BuildPathItem, CoachingResponse } from "./types";

/**
 * The game-plan user message.
 *
 * State-agnostic by design: the same prompt serves the auto-fired opening plan
 * AND the mid-game "update plan" voice command. The [Game State] block that
 * precedes this message carries every temporal input the LLM needs (current
 * items, game time, enemy itemization, augments, KDA). If the LLM needs to
 * revise vs. draft from scratch, that conclusion is driven by what it sees in
 * the snapshot — not by a "this is the start of the game" / "this is mid-game"
 * anchor in the prompt.
 *
 * Instructs the LLM to return its 6-item build path in the structured
 * `buildPath` field with per-item category + reason (not in `recommendations`),
 * so the UI can render category icons and counter-target associations (#99).
 */
export function buildGamePlanQuestion(): string {
  return [
    "Based on the current game state — my champion, current inventory, the enemy team composition and their itemization, my chosen augments, and the game mode — give me my game plan: what to watch out for, who to focus, and my recommended 6-item build path in order. If the state shows items already built, factor them in and keep recommending from the remaining slots so the full 6-item path still reflects the end-state build.",
    "",
    "Return the 6 items in the `buildPath` field of your response (not in `recommendations`). For each item:",
    "- name: exact item name from the Item Catalog.",
    "- category: one of core | counter | defensive | damage | utility | situational.",
    "- targetEnemy: REQUIRED when category is `counter` — name the specific enemy champion this item addresses. Omit for every other category.",
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
 *
 * The strict `^update\s+(?:game\s+)?plan$` original (from #17) missed
 * trailing punctuation, articles, and leading filler — routing most
 * real-world phrasings to general coaching and leaving the side panel stale.
 */
const UPDATE_PLAN_PATTERN =
  /^(?:please\s+|hey\s+|ok\s+|okay\s+|coach\s+)?(update|refresh|rework|redo|replace|remake)\s+(?:the\s+|my\s+)?(?:game\s+)?plan\b/i;

export function isUpdatePlanCommand(text: string): boolean {
  return UPDATE_PLAN_PATTERN.test(text.trim());
}

/**
 * Pull the structured build path out of a coaching response.
 *
 * Prefers the `buildPath` field. When absent (older prompt formats or a
 * malformed retry response), promotes each recommendation to a build-path item
 * so the UI still renders something usable instead of an empty panel.
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
