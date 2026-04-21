import type { GameMode } from "../mode/types";
import { ITEM_REC_TASK_PROMPT } from "./features/item-rec/prompt";
import { AUGMENT_FIT_TASK_PROMPT } from "./features/augment-fit/prompt";

/**
 * Compatibility-shim concatenation of every feature's task prompt, used by
 * `buildGameSystemPrompt` and the current eval harness. In production code
 * the app routes to specific features via `session.ask(feature, input)` —
 * each feature contributes only its own prompt. Phase 8 retires this helper
 * once the eval harness migrates to per-feature harnesses.
 */
export function buildFeatureRules(mode: GameMode): string {
  const parts = [ITEM_REC_TASK_PROMPT];
  if (mode.decisionTypes.includes("augment-selection")) {
    parts.push(AUGMENT_FIT_TASK_PROMPT);
  }
  return parts.join("\n\n");
}
