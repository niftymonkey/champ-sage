/**
 * Task prompt for voice-query feature.
 *
 * Freeform conversational coaching. The player could be asking about
 * champion mechanics, combos, positioning, earlier advice, synergies
 * between chosen augments, or anything else that isn't a direct item
 * purchase or augment offer. This prompt leans into the conversation
 * history and game state without imposing rigid item-rec formatting.
 */
export const VOICE_QUERY_TASK_PROMPT = [
  "CONVERSATIONAL COACHING: This is an open-ended voice question, not a structured item-rec or augment-fit request.",
  "- Use the cumulative conversation history — prior questions, prior recommendations, prior augments picked — as context when answering follow-ups or references to 'that' / 'the one you suggested' / etc.",
  "- Speak to what the player actually asked. A question about champion mechanics, ability combos, or positioning gets a direct mechanical answer, not a build recommendation.",
  "- Items, augments, and set synergies can be named naturally in prose. Do NOT force the 'Build toward X. You can get Y now.' destination-plus-component format unless the player is clearly asking what to buy next.",
  "- Prefer recommendations[] for questions that offer a short list of options; leave it empty when the answer is prose only.",
].join("\n");
