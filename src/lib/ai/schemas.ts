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
          reasoning: {
            type: "string",
            description: "Why this option is recommended in this context",
          },
        },
        required: ["name", "reasoning"],
        additionalProperties: false,
      },
      description:
        "Ranked recommendations if applicable (empty array if the question is not about choosing between options)",
    },
  },
  required: ["answer", "recommendations"],
  additionalProperties: false,
});
