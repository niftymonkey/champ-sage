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
  },
  required: ["answer", "recommendations"],
  additionalProperties: false,
});
