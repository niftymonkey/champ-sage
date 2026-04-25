import type { CoachingFeature } from "../../feature";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { ITEM_REC_TASK_PROMPT } from "./prompt";
import { itemRecSchema, type ItemRecResult } from "./schema";

export type { ItemRecResult } from "./schema";

/**
 * What initiated this item-rec call. Used by buildUserMessage to add a
 * framing line that helps the LLM tune urgency and forward-looking phrasing.
 *
 * - "voice": player asked via voice/text — reactive, conversational.
 * - "shop-moment": proactive engine fired on death-with-gold — player is at
 *   the shop right now; advice should be actionable in seconds.
 * - "gold-available": proactive engine fired when gold reached the next
 *   main item's threshold — forward-looking, "next time you shop..."
 */
export type ItemRecTrigger = "voice" | "shop-moment" | "gold-available";

export interface ItemRecInput {
  readonly snapshot: GameSnapshot | null;
  readonly question: string;
  /** Defaults to "voice" for backward compatibility with the existing reactive path. */
  readonly trigger?: ItemRecTrigger;
}

const TRIGGER_FRAMING: Record<Exclude<ItemRecTrigger, "voice">, string> = {
  "shop-moment":
    "[Trigger: shop-moment] The player just died and is at the shop. Give them 2–3 strong purchase options they can act on in the next few seconds.",
  "gold-available":
    "[Trigger: gold-available] The player just reached enough gold to afford the next main item in their plan. Frame the response as forward-looking — what to prioritize on the next shop trip.",
};

export const itemRecFeature: CoachingFeature<ItemRecInput, ItemRecResult> = {
  id: "item-rec",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => `\n\n${ITEM_REC_TASK_PROMPT}`,

  buildUserMessage: ({ snapshot, question, trigger = "voice" }) => {
    const snapshotText = snapshot ? formatStateSnapshot(snapshot) : "";
    const sections = [`[Game State]\n${snapshotText}`];
    if (trigger !== "voice") {
      sections.push(TRIGGER_FRAMING[trigger]);
    }
    sections.push(`[Question]\n${question}`);
    return sections.join("\n\n");
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
