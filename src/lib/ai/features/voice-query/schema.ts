import { jsonSchema } from "ai";
import type { Recommendation } from "../../types";

/**
 * Output shape for the voice-query feature.
 *
 * Freeform conversational coaching — the player could be asking about
 * mechanics, combos, positioning, earlier advice, synergies, or anything
 * else. `recommendations` is always present (OpenAI strict mode requires
 * listed fields); it's an empty array for pure-prose answers.
 */
export interface VoiceQueryResult {
  answer: string;
  recommendations: Recommendation[];
}

export const voiceQuerySchema = jsonSchema<VoiceQueryResult>({
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "Direct answer to the player's question, 1-3 sentences, conversational and context-aware.",
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Name of the option being discussed (item, augment, etc.).",
          },
          fit: {
            type: "string",
            enum: ["exceptional", "strong", "situational", "weak"],
            description: "Fit rating if the answer is comparing options.",
          },
          reasoning: {
            type: "string",
            description: "Terse reason tied to the option.",
          },
        },
        required: ["name", "fit", "reasoning"],
        additionalProperties: false,
      },
      description:
        "Optional list of options when the question is a short choice between picks. Empty array for prose-only answers.",
    },
  },
  required: ["answer", "recommendations"],
  additionalProperties: false,
});
