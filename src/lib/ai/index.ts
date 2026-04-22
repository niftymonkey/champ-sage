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
export type { CoachingFeature, MatchPhase, AskResult } from "./feature";
export { runFeatureCall } from "./recommendation-engine";
export { buildBaseContext, type BaseContextInputs } from "./base-context";
export { buildFeatureRules } from "./feature-rules";

export {
  createGamePlanFeature,
  buildGamePlanQuestion,
  extractBuildPath,
  isUpdatePlanCommand,
  type GamePlanInput,
  type GamePlanResult,
} from "./features/game-plan";
export {
  augmentFitFeature,
  type AugmentFitInput,
  type AugmentFitResult,
} from "./features/augment-fit";
export {
  itemRecFeature,
  type ItemRecInput,
  type ItemRecResult,
} from "./features/item-rec";
export {
  voiceQueryFeature,
  type VoiceQueryInput,
  type VoiceQueryResult,
} from "./features/voice-query";
