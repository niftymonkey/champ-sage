import { jsonSchema } from "ai";
import type { CoachingResponse } from "./types";

export const coachingResponseSchema = jsonSchema<CoachingResponse>({
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "Direct answer to the player's question",
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the recommended option (augment, item, etc.)",
          },
          fit: {
            type: "string",
            enum: ["exceptional", "strong", "situational", "weak"],
            description:
              "Independent fit rating for this option against the current build and game state",
          },
          reasoning: {
            type: "string",
            description:
              "What this option does and why it fits (or doesn't) the current state",
          },
        },
        required: ["name", "fit", "reasoning"],
        additionalProperties: false,
      },
      description:
        "Recommendations with independent fit ratings (empty array if the question is not about choosing between options)",
    },
    buildPath: {
      // Nullable + listed in `required` because OpenAI strict-mode
      // structured outputs reject schemas with unlisted optional properties.
      // Game-plan queries return a 6-item array; all other queries return null.
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact item name from the item catalog",
          },
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
              "Visual category — core (champion staple), counter (addresses a specific enemy), defensive (survivability vs comp), damage (damage amp), utility (team support/CC/vision), situational (catch-all, use sparingly)",
          },
          targetEnemy: {
            // Same strict-mode reason as above: required + nullable.
            // Populated with the enemy champion name for counter picks,
            // set to null for every other category.
            type: ["string", "null"],
            description:
              "Enemy champion name being countered — set for category 'counter', null otherwise",
          },
          reason: {
            type: "string",
            description:
              "Terse reason — a few words max, sacrifice grammar for concision",
          },
        },
        required: ["name", "category", "targetEnemy", "reason"],
        additionalProperties: false,
      },
      description:
        "Return a 6-item array for game-plan queries (the question explicitly asks for the build path). Return null for all other queries.",
    },
  },
  required: ["answer", "recommendations", "buildPath"],
  additionalProperties: false,
});
