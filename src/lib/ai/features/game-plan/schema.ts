import { jsonSchema } from "ai";
import type { BuildPathItem } from "../../types";

/**
 * Output shape for the game-plan feature.
 *
 * Always returns a 6-item `buildPath` alongside a short prose `answer`.
 * `buildPath` is required (not nullable) because this feature always
 * produces one — previously it was nullable to accommodate the shared
 * `CoachingResponse` shape used by non-game-plan calls, which is retired
 * in the per-feature refactor.
 */
export interface GamePlanResult {
  answer: string;
  buildPath: BuildPathItem[];
}

/**
 * OpenAI's structured-output enum has a practical upper bound; keeping the
 * guard avoids schemas that the API would reject. For the current item
 * catalog (~300 items after mode filtering) this is comfortably under the
 * limit, but a future data version could blow past it.
 */
const MAX_ENUM_SIZE = 500;

/**
 * Build the game-plan output schema with an item-name enum pinned to the
 * player's actual item catalog. This is the structural fix for #109 —
 * without the enum the LLM occasionally slots augment or set names into
 * `buildPath[].name`; OpenAI's strict-mode validator rejects any output
 * whose `name` isn't in the enum, so the class of failures disappears at
 * decode time.
 *
 * When the item-name list exceeds the enum limit (unlikely but possible),
 * falls back to a plain string schema. In that degraded mode invalid names
 * are NOT filtered (`extractResult` is a pass-through) — callers get
 * whatever the model returned. Tracked alongside #89 (permissive scorer
 * patterns); revisit if the catalog ever grows past the enum cap in
 * practice.
 */
export function createGamePlanSchema(itemNames: readonly string[]) {
  const canEnumerate =
    itemNames.length > 0 && itemNames.length <= MAX_ENUM_SIZE;

  const nameSchema = canEnumerate
    ? {
        type: "string" as const,
        enum: [...itemNames],
        description:
          "Exact item name from the Item Catalog. Must be one of the enumerated values — augment, set, and rune names are not valid here.",
      }
    : {
        type: "string" as const,
        description:
          "Exact item name from the Item Catalog. Augment, set, and rune names are not valid here.",
      };

  return jsonSchema<GamePlanResult>({
    type: "object",
    properties: {
      answer: {
        type: "string",
        description:
          "Short prose summary of the game plan — what to watch out for, who to focus, and the shape of the build. 1-3 sentences.",
      },
      buildPath: {
        type: "array",
        minItems: 6,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            name: nameSchema,
            category: {
              type: "string",
              enum: [
                "core",
                "counter",
                "defensive",
                "damage",
                "utility",
                "situational",
              ],
              description:
                "Visual category — core (champion staple), counter (addresses a specific enemy), defensive (survivability vs comp), damage (damage amp), utility (team support/CC/vision), situational (catch-all, use sparingly).",
            },
            targetEnemy: {
              type: ["string", "null"],
              description:
                "Enemy champion name being countered — set for category 'counter', null otherwise.",
            },
            reason: {
              type: "string",
              description:
                "Terse reason — a few words max, sacrifice grammar for concision.",
            },
          },
          required: ["name", "category", "targetEnemy", "reason"],
          additionalProperties: false,
        },
        description:
          "Exactly 6 items, in order, covering the full recommended build.",
      },
    },
    required: ["answer", "buildPath"],
    additionalProperties: false,
  });
}
