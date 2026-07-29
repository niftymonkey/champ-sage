export type {
  CoachingResponse,
  Recommendation,
  CoachingContext,
  CoachingQuery,
  CoachingExchange,
} from "./types";
export { MODEL_CONFIG, createCoachingModel } from "./model-config";
export { assembleContext } from "./context-assembler";
export type { CoachingFeature, MatchPhase, AskResult } from "./feature";
export { runFeatureCall } from "./recommendation-engine";
export { buildBaseContext, type BaseContextInputs } from "./base-context";

export {
  createGamePlanFeature,
  buildGamePlanQuestion,
  describeBuildPathDrop,
  enforceBuildPathLegality,
  extractBuildPath,
  isUpdatePlanCommand,
  type BootsCollisionDrop,
  type BuildPathDrop,
  type BuildPathLegalityResult,
  type DuplicateNameDrop,
  type GamePlanInput,
  type GamePlanResult,
  type MutexCollisionDrop,
} from "./features/game-plan";
export {
  buildCorrectiveMessage,
  remediateGamePlan,
  type RemediatedGamePlan,
  type RemediateGamePlanOptions,
} from "./features/game-plan/remediation";
export {
  augmentFitFeature,
  type AugmentFitInput,
  type AugmentFitResult,
} from "./features/augment-fit";
export {
  isItemRecQuestion,
  itemRecFeature,
  type ItemRecInput,
  type ItemRecResult,
} from "./features/item-rec";
export {
  describeRecommendationDrop,
  enforceRecommendationLegality,
  type AlreadyOwnedDrop,
  type DuplicateOptionDrop,
  type OptionModeUnavailableDrop,
  type OwnedBootsCollisionDrop,
  type OwnedGroupCollisionDrop,
  type RecommendationDrop,
  type RecommendationLegalityResult,
} from "./features/item-rec/legality";
export {
  buildItemRecCorrectiveMessage,
  remediateItemRec,
  type RemediatedItemRec,
  type RemediateItemRecOptions,
} from "./features/item-rec/remediation";
export {
  voiceQueryFeature,
  type VoiceQueryInput,
  type VoiceQueryResult,
} from "./features/voice-query";
