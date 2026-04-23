import { describe, it, expect } from "vitest";
import { scorePivotExplanation } from "./scorers";

describe("scorePivotExplanation", () => {
  const emptyHistory: Array<{ question: string; answer: string }> = [];

  it("returns 1 when pivotExpected is undefined (N/A fixture)", () => {
    expect(
      scorePivotExplanation(
        "Build Thornmail.",
        undefined,
        undefined,
        emptyHistory
      )
    ).toBe(1);
  });

  it("returns 1 when pivotExpected is false and response is consistent", () => {
    expect(
      scorePivotExplanation(
        "Still recommend Spirit Visage for the MR and healing.",
        false,
        "Spirit Visage",
        emptyHistory
      )
    ).toBe(1);
  });

  it("returns 1 when pivot detected and explanation uses 'because'", () => {
    expect(
      scorePivotExplanation(
        "Switch to Force of Nature because their team added more AP threats.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(1);
  });

  it("returns 1 when pivot detected and explanation uses 'since'", () => {
    expect(
      scorePivotExplanation(
        "Build Randuin's Omen instead. Since they sold their healing items, Thornmail is less valuable.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(1);
  });

  it("returns 1 when pivot detected and explanation uses 'now that'", () => {
    expect(
      scorePivotExplanation(
        "Now that you picked Goliath, pivot to Heartsteel for the synergy.",
        true,
        "Infinity Edge",
        emptyHistory
      )
    ).toBe(1);
  });

  it("returns 0 when pivot detected but no explanation", () => {
    expect(
      scorePivotExplanation(
        "Build Force of Nature.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(0);
  });

  it("returns 0 when pivot detected and response has no causal language", () => {
    expect(
      scorePivotExplanation(
        "Get Randuin's Omen next. You can pick up a Warden's Mail now.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(0);
  });

  it("returns 0.5 when pivot expected but response still recommends same item", () => {
    expect(
      scorePivotExplanation(
        "Build toward Thornmail. You can get a Bramble Vest now.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(0.5);
  });

  it("returns 1 when response explicitly says 'still recommend' the prior item with pivotExpected false", () => {
    expect(
      scorePivotExplanation(
        "I still recommend Spirit Visage — the healing synergy is too good to pass up.",
        false,
        "Spirit Visage",
        emptyHistory
      )
    ).toBe(1);
  });

  it("handles case-insensitive comparison of prior recommendation", () => {
    expect(
      scorePivotExplanation(
        "Build toward THORNMAIL for the armor and anti-heal.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(0.5);
  });

  it("returns 0.5 when pivot expected but response reaffirms prior item with causal language", () => {
    expect(
      scorePivotExplanation(
        "Keep Thornmail because it gives you armor and anti-heal.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(0.5);
  });

  it("returns 1 with explanation using 'instead' for pivot", () => {
    expect(
      scorePivotExplanation(
        "Go for Wit's End instead — your augment synergizes better with on-hit.",
        true,
        "Thornmail",
        emptyHistory
      )
    ).toBe(1);
  });
});
