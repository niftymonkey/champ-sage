import { describe, it, expect } from "vitest";
import { isItemRecQuestion } from "./index";

describe("isItemRecQuestion", () => {
  describe("matches item-purchase questions", () => {
    const hits = [
      // Failing fixtures from #113 eval regression
      "What's my next item?",
      "Should I still be building tank items?",
      "What item should I buy?",
      "Still building Spirit Visage?",
      "What item do I need?",
      "Same build?",
      "What should I build next?",
      // Other natural item-rec phrasings
      "What should I buy?",
      "What do I buy next?",
      "Do I build tank or damage?",
      "What's a good item for this matchup?",
      "Should I rush Zhonya's?",
      "What builds work on Yasuo?",
      // Whisper sometimes drops terminal punctuation
      "what item do I need",
      "what should I build next",
      // Case-insensitive
      "WHAT ITEM SHOULD I BUY?",
    ];
    for (const phrase of hits) {
      it(`matches "${phrase}"`, () => {
        expect(isItemRecQuestion(phrase)).toBe(true);
      });
    }
  });

  describe("does not match strategic, positional, or mechanical questions", () => {
    const misses = [
      "Who should I focus?",
      "Should I go dragon?",
      "Am I winning lane?",
      "What's the plan?",
      "Should I push or farm?",
      "When do I all-in?",
      "How do I play this matchup?",
      "Can you coach me on trading?",
      "What's my power spike?",
      // Statements of fact mentioning item words — not questions
      "I just built my boots.",
      "I'm building my lead.",
      "Rush Zhonya's",
      // "Update game plan" command — routed earlier by isUpdatePlanCommand
      "Update game plan",
      // Empty / whitespace
      "",
      "   ",
    ];
    for (const phrase of misses) {
      it(`does not match "${phrase}"`, () => {
        expect(isItemRecQuestion(phrase)).toBe(false);
      });
    }
  });
});
