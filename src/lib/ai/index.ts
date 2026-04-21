export type {
  CoachingResponse,
  Recommendation,
  CoachingContext,
  CoachingQuery,
  CoachingExchange,
} from "./types";
export { MODEL_CONFIG, createCoachingModel } from "./model-config";
export { coachingResponseSchema } from "./schemas";
export { buildGameSystemPrompt } from "./prompts";
export { assembleContext } from "./context-assembler";
export type { CoachingFeature, MatchPhase, ExtractMeta } from "./feature";
export { runFeatureCall } from "./recommendation-engine";
export { createCoachingFeature } from "./features/coaching";
export { buildBaseContext, type BaseContextInputs } from "./base-context";
export { buildFeatureRules } from "./feature-rules";
