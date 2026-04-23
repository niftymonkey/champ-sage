import { describe, it, expect } from "vitest";
import { scoreBrevity } from "./scorers";

describe("scoreBrevity", () => {
  it("scores 1 for a 1-sentence response", () => {
    expect(scoreBrevity("Buy Thornmail next.")).toBe(1);
  });

  it("scores 1 for a 2-sentence response", () => {
    expect(
      scoreBrevity(
        "Buy **Thornmail** next. It gives you armor and grievous wounds against their healing."
      )
    ).toBe(1);
  });

  it("scores 0.5 for a 5-sentence response", () => {
    expect(
      scoreBrevity(
        "Buy Thornmail next. It gives armor. It also has grievous wounds. " +
          "This is great against Viego. You need the anti-heal badly."
      )
    ).toBe(0.5);
  });

  it("scores 0 for a 6+ sentence response", () => {
    expect(
      scoreBrevity(
        "Buy Thornmail next. It gives armor. It has grievous wounds. " +
          "Viego heals a lot. Your team needs anti-heal. Caitlyn also has lifesteal. " +
          "This is the single best defensive option available."
      )
    ).toBe(0);
  });
});
