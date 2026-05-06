import { jsonSchema } from "ai";

/**
 * Output shape for the post-game-takeaway feature. The structured
 * numerical data on the post-game surface (KDA, build comparison,
 * timeline) comes from the rest of the decision log + eogStats; this
 * feature only contributes the narrative reflection.
 */
export interface PostGameTakeawayResult {
  narrative: string;
}

export const postGameTakeawaySchema = jsonSchema<PostGameTakeawayResult>({
  type: "object",
  properties: {
    narrative: {
      type: "string",
      description:
        "2-4 sentence past-tense reflection on the match. Italic emphasis allowed via single-asterisk markdown on key items, augments, or pivots. No advice or should-haves.",
    },
  },
  required: ["narrative"],
  additionalProperties: false,
});
