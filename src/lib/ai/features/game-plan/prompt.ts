/**
 * Task prompt for game-plan feature.
 *
 * The game-plan question itself (in `buildGamePlanQuestion()`) carries the
 * bulk of the rules — buildPath structure, category definitions, target
 * format. This task prompt reinforces the item-catalog constraint for the
 * `buildPath[].name` field so the LLM doesn't emit augment or set names
 * where item names are required (#109 prompt-level defense; Phase 4 adds
 * the structural enum fix). The boots-uniqueness rule also lives here
 * because schema enums can't express "at most one Boots-tagged value";
 * it's enforced by prompt and guaranteed post-hoc by the boots rule inside
 * enforceBuildPathLegality (#117 slice 5; boots are tag-based, not a wiki
 * itemlimit group). The mutex-group rule (#117 slice) follows the same
 * pattern: the item catalog's Purchase restrictions section names the
 * colliding items, the rule here forbids pairing them, and
 * enforceBuildPathLegality guarantees it post-hoc, along with the
 * duplicate-name and owned-item rules below.
 */
export const GAME_PLAN_TASK_PROMPT = [
  "GAME PLAN BUILD PATH:",
  "- Every `name` in `buildPath` MUST be an exact item name from the Item Catalog above. Do not use augment names, rune names, or any string that does not appear in the Item Catalog.",
  "- Augments provide passive effects the build should account for, but they are NEVER listed in `buildPath`. Build-path entries are purchasable items only.",
  "- `buildPath` must contain at most one Boots item — the player can only equip one pair at a time. Pick the single boots upgrade that best fits the matchup and use the remaining slots for non-boots items.",
  "- Some items are mutually exclusive: the Item Catalog's \"Purchase restrictions\" section lists groups the game caps at ONE owned item (for example, the Last Whisper items Lord Dominik's Regards and Mortal Reminder share a group). `buildPath` must NEVER contain two items from the same restriction group; pick the one that fits the matchup best.",
  "- `buildPath` must NEVER list the same item name twice: the shop allows only ONE copy of each completed item. Items the player already owns still appear exactly once, in their end-state slot. Never add a second copy of an item the player owns, and never add an item from the same restriction group as one the player already owns (the shop blocks that purchase).",
].join("\n");
