import type { CoachingFeature } from "../../feature";
import type { CoachingResponse } from "../../types";
import { coachingResponseSchema } from "../../schemas";

/**
 * Input shape every current call site already constructs: a formatted state
 * snapshot plus the player's question (or an auto-generated question for
 * game-plan / augment-offer calls).
 */
export interface CoachingFeatureInput {
  readonly stateSnapshot: string;
  readonly question: string;
}

/**
 * Unified coaching feature: every current call site (game-plan, augment
 * offer, voice Q&A, item rec) funnels through this one contract. The task
 * prompt is empty because the session's base context carries every rule;
 * `extractResult` splats `retried` onto the response body so consumers that
 * already read `response.retried` keep working.
 */
export const coachingFeature: CoachingFeature<
  CoachingFeatureInput,
  CoachingResponse
> = {
  id: "coaching",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => "",

  buildUserMessage: ({ stateSnapshot, question }) =>
    `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`,

  outputSchema: coachingResponseSchema,

  extractResult: (raw, meta) =>
    meta.retried ? { ...raw, retried: true } : raw,
};
