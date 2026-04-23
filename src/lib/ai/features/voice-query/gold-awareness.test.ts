import { describe, it, expect } from "vitest";
import { scoreGoldAwareness } from "./gold-awareness";

describe("scoreGoldAwareness", () => {
  it("scores 1 for non-item questions", () => {
    expect(
      scoreGoldAwareness("Take Outlaw's Grit.", 1400, "Which augment?")
    ).toBe(1);
  });

  it("scores 1 when response gives concrete buy advice", () => {
    expect(
      scoreGoldAwareness(
        "Buy **Bami's Cinder** next. Best immediate spike.",
        1400,
        "What should I buy?"
      )
    ).toBe(1);
  });

  it("scores 0 when response hedges about gold", () => {
    expect(
      scoreGoldAwareness(
        "Buy **Berserker's Greaves** if you can afford it.",
        1400,
        "What's my first item?"
      )
    ).toBe(0);
  });

  it("scores 0 for 'if you can buy now' hedging", () => {
    expect(
      scoreGoldAwareness(
        "Best first buy: **Berserker's Greaves** if you can buy now.",
        1400,
        "What's my first item?"
      )
    ).toBe(0);
  });

  it("scores 0 for 'save up for' hedging", () => {
    expect(
      scoreGoldAwareness(
        "Save up for **Infinity Edge** next.",
        2000,
        "What item should I buy next?"
      )
    ).toBe(0);
  });

  it("scores 1 when gold is 0", () => {
    expect(
      scoreGoldAwareness(
        "Save gold for your next item.",
        0,
        "What should I buy?"
      )
    ).toBe(1);
  });
});
