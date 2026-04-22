import { jsonSchema } from "ai";
import type { Recommendation } from "../../types";

/**
 * Output shape for the item-rec feature.
 *
 * Freeform short answer plus a list of recommended item options, each with
 * an independent fit rating. Used for "what should I buy" style questions
 * and future proactive shop-moment triggers.
 */
export interface ItemRecResult {
  answer: string;
  recommendations: Recommendation[];
}

export const itemRecSchema = jsonSchema<ItemRecResult>({
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "Direct answer to the player's question, 1-3 sentences, lead with the top pick.",
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact item name from the item catalog.",
          },
          fit: {
            type: "string",
            enum: ["exceptional", "strong", "situational", "weak"],
            description:
              "Independent fit rating for this item against the current build and game state.",
          },
          reasoning: {
            type: "string",
            description: "Terse reason — what the item does and why it fits.",
          },
        },
        required: ["name", "fit", "reasoning"],
        additionalProperties: false,
      },
      description:
        "Item options with fit ratings. Empty array when the answer is standalone.",
    },
  },
  required: ["answer", "recommendations"],
  additionalProperties: false,
});
