import type { CoachingFeature } from "../../feature";
import type { CoachingResponse } from "../../types";
import type { GameMode } from "../../../mode/types";
import { coachingResponseSchema } from "../../schemas";
import { buildFeatureRules } from "../../feature-rules";

export interface CoachingFeatureInput {
  readonly stateSnapshot: string;
  readonly question: string;
}

/**
 * Unified coaching feature bound to the current game mode.
 *
 * Every current call site (game-plan, augment offer, voice Q&A, item rec)
 * funnels through this one contract. The task prompt contributes the
 * feature-rule block — item recommendation format, proactive awareness, and
 * (when the mode supports it) augment fit rating and synergy coaching —
 * appended after the session's base context. `extractResult` splats
 * `retried` onto the response body so consumers that already read
 * `response.retried` keep working.
 *
 * Binding to `mode` at construction keeps the session's base context and
 * feature rules in sync for the lifetime of the match. A new mode means a
 * new session and a new feature.
 */
export function createCoachingFeature(
  mode: GameMode
): CoachingFeature<CoachingFeatureInput, CoachingResponse> {
  const rules = buildFeatureRules(mode);
  const taskPrompt = rules ? `\n\n${rules}` : "";

  return {
    id: "coaching",
    supportedPhases: ["in-game"] as const,

    buildTaskPrompt: () => taskPrompt,

    buildUserMessage: ({ stateSnapshot, question }) =>
      `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`,

    outputSchema: coachingResponseSchema,

    extractResult: (raw, meta) =>
      meta.retried ? { ...raw, retried: true } : raw,
  };
}
