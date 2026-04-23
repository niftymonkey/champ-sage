import { jsonSchema } from "ai";
import type { Recommendation } from "../../types";

/**
 * Output shape for the augment-fit feature.
 *
 * No `answer` field — the augment-fit UI renders badges per augment card,
 * not free-form prose. Each recommendation carries an independent fit rating
 * plus the reasoning used on the card hover / feed entry.
 */
export interface AugmentFitResult {
  recommendations: Recommendation[];
}

export const augmentFitSchema = jsonSchema<AugmentFitResult>({
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The offered augment's exact name.",
          },
          fit: {
            type: "string",
            enum: ["exceptional", "strong", "situational", "weak"],
            description:
              "Independent fit rating for this augment against the current build and game state.",
          },
          reasoning: {
            type: "string",
            description:
              "What the augment does and why it fits (or doesn't) the current state. No imperative language.",
          },
        },
        required: ["name", "fit", "reasoning"],
        additionalProperties: false,
      },
      description:
        "One entry per offered augment, in any order — the UI matches by name.",
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
});
