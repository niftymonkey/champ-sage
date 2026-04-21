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
export { buildBaseContext, type BaseContextInputs } from "./base-context";
export { buildFeatureRules } from "./feature-rules";

export {
  gamePlanFeature,
  buildGamePlanQuestion,
  extractBuildPath,
  isUpdatePlanCommand,
  type GamePlanInput,
} from "./features/game-plan";
export {
  augmentFitFeature,
  type AugmentFitInput,
} from "./features/augment-fit";
export { itemRecFeature, type ItemRecInput } from "./features/item-rec";
export {
  voiceQueryFeature,
  type VoiceQueryInput,
} from "./features/voice-query";
