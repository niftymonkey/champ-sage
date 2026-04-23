import { describe, it, expect } from "vitest";
import { scoreDecisiveness } from "./scorers";

describe("scoreDecisiveness", () => {
  it("scores 1 for a decisive response", () => {
    expect(
      scoreDecisiveness("Take **Outlaw's Grit**. Re-roll the other two.")
    ).toBe(1);
  });

  it("scores 0.5 for a single hedge", () => {
    expect(
      scoreDecisiveness(
        "It depends on your playstyle, but Outlaw's Grit is probably best."
      )
    ).toBe(0.5);
  });

  it("scores 0 for multiple hedges", () => {
    expect(
      scoreDecisiveness(
        "It depends on your playstyle. It's up to you which direction to take here."
      )
    ).toBe(0);
  });
});
