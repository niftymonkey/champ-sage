import type { CoachingFeature } from "../../feature";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { ITEM_REC_TASK_PROMPT } from "./prompt";
import { itemRecSchema, type ItemRecResult } from "./schema";

export type { ItemRecResult } from "./schema";

export interface ItemRecInput {
  readonly snapshot: GameSnapshot | null;
  readonly question: string;
}

export const itemRecFeature: CoachingFeature<ItemRecInput, ItemRecResult> = {
  id: "item-rec",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => `\n\n${ITEM_REC_TASK_PROMPT}`,

  buildUserMessage: ({ snapshot, question }) => {
    const snapshotText = snapshot ? formatStateSnapshot(snapshot) : "";
    return `[Game State]\n${snapshotText}\n\n[Question]\n${question}`;
  },

  outputSchema: itemRecSchema,

  extractResult: (raw) => raw,

  summarizeForHistory: (result) => result.answer,
};

/**
 * Classifier for the item-rec routing gate (#113).
 *
 * Two-clause match:
 *
 * 1. **Item-intent signal** — one of the words that's reliably about
 *    buying/building items (`item(s)`, `build(s)`/`building`, `buy(s)`/`buying`,
 *    `purchase`/`purchasing`, `rush`/`rushing`). The tense/number variants
 *    matter: past-tense `built` intentionally doesn't match, since "I just
 *    built my boots" is a statement, not a request for a recommendation.
 * 2. **Question shape** — either a `?` suffix OR a leading wh-word / modal /
 *    auxiliary. Whisper occasionally drops terminal punctuation, so we can't
 *    rely on `?` alone. Requiring question shape rules out statements of
 *    fact that mention build/item words ("I'm building my lead.").
 *
 * Both clauses must hold — the keyword alone has too many false positives,
 * and the shape alone misses item questions. The combination nails the
 * failing fixture set from #113 without bleeding into strategic, positional,
 * or mechanical questions.
 */
const ITEM_INTENT_PATTERN =
  /\b(items?|builds?|building|buy(?:ing|s)?|purchas(?:e|es|ing)|rush(?:ing|es)?)\b/i;
const QUESTION_SHAPE_PATTERN =
  /\?\s*$|^\s*(what|which|should|do|does|did|am|are|is|can|could|would|will)\b/i;

export function isItemRecQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    ITEM_INTENT_PATTERN.test(trimmed) && QUESTION_SHAPE_PATTERN.test(trimmed)
  );
}
