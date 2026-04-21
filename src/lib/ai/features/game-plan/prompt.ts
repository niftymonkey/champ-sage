/**
 * Task prompt for game-plan feature.
 *
 * The game-plan question itself (in `buildGamePlanQuestion()`) carries the
 * bulk of the rules — buildPath structure, category definitions, target
 * format. This task prompt reinforces the item-catalog constraint for the
 * `buildPath[].name` field so the LLM doesn't emit augment or set names
 * where item names are required (#109 prompt-level defense; Phase 4 adds
 * the structural enum fix).
 */
export const GAME_PLAN_TASK_PROMPT = [
  "GAME PLAN BUILD PATH:",
  "- Every `name` in `buildPath` MUST be an exact item name from the Item Catalog above. Do not use augment names, set names, rune names, or any string that does not appear in the Item Catalog.",
  "- Augments and set bonuses provide passive effects the build should account for, but they are NEVER listed in `buildPath`. Build-path entries are purchasable items only.",
].join("\n");
