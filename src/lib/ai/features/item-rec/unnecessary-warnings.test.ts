import { describe, it, expect } from "vitest";
import { scoreUnnecessaryWarnings } from "./scorers";

describe("scoreUnnecessaryWarnings", () => {
  it("scores 1 for clean response without warnings", () => {
    expect(
      scoreUnnecessaryWarnings(
        "Buy **Warmog's Armor** next. Best HP spike for your build.",
        "What should I buy?"
      )
    ).toBe(1);
  });

  it("scores 0 when response warns about not re-buying owned items", () => {
    expect(
      scoreUnnecessaryWarnings(
        "Get Tier 2 Boots now. Don't buy Heartsteel again.",
        "I chose Quest Steel Your Heart."
      )
    ).toBe(0);
  });

  it("scores 1 when player explicitly asks about re-buying", () => {
    expect(
      scoreUnnecessaryWarnings(
        "No, don't buy Heartsteel again. One is enough.",
        "Should I buy Heartsteel again?"
      )
    ).toBe(1);
  });

  it("scores 0 for 'no need to buy X again' pattern", () => {
    expect(
      scoreUnnecessaryWarnings(
        "Good choice. No need to buy Thornmail again since you already have it.",
        "I chose Overflow."
      )
    ).toBe(0);
  });
});
