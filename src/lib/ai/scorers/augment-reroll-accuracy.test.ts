import { describe, it, expect } from "vitest";
import { scoreAugmentRerollAccuracy } from "./augment-reroll-accuracy";

describe("scoreAugmentRerollAccuracy", () => {
  it("scores 1 for non-augment questions", () => {
    expect(
      scoreAugmentRerollAccuracy(
        "Buy Thornmail next.",
        "What should I buy?",
        []
      )
    ).toBe(1);
  });

  it("scores 1 for first-round augment advice with valid re-roll suggestions", () => {
    const response = "Take **Outlaw's Grit**. Re-roll the other two.";
    expect(
      scoreAugmentRerollAccuracy(
        response,
        "Pinball, Outlaw's Grit, and Big Brain",
        []
      )
    ).toBe(1);
  });

  it("scores 1 for follow-up round with valid advice", () => {
    const history = [
      {
        question: "Pinball, Outlaw's Grit, and Big Brain",
        answer: "Take Outlaw's Grit. Re-roll the other two.",
      },
    ];
    const response = "The new options are worse. Take Outlaw's Grit.";
    expect(
      scoreAugmentRerollAccuracy(
        response,
        "Searing Dawn and Recursion",
        history
      )
    ).toBe(1);
  });

  it("scores 0 when suggesting re-roll all three in a follow-up round", () => {
    const history = [
      {
        question: "Pinball, Outlaw's Grit, and Big Brain",
        answer: "Take Outlaw's Grit. Re-roll the other two.",
      },
    ];
    const response =
      "None of these are great. Re-roll all three and hope for better.";
    expect(
      scoreAugmentRerollAccuracy(
        response,
        "Searing Dawn and Recursion",
        history
      )
    ).toBe(0);
  });

  it("scores 1 when suggesting re-roll all three on first round (valid)", () => {
    const response =
      "None of these are great for Warwick. Re-roll all three if you can.";
    expect(
      scoreAugmentRerollAccuracy(
        response,
        "Pinball, Big Brain, and Searing Dawn",
        []
      )
    ).toBe(1);
  });
});
