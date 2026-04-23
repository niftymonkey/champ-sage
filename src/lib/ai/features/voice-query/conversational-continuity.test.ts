import { describe, it, expect } from "vitest";
import { scoreConversationalContinuity } from "./scorers";

describe("scoreConversationalContinuity", () => {
  it("scores 1 when no expected references (not a continuity test)", () => {
    expect(
      scoreConversationalContinuity("Buy Thornmail next.", undefined)
    ).toBe(1);
  });

  it("scores 1 when response contains an expected reference", () => {
    expect(
      scoreConversationalContinuity(
        "Yes, Thornmail is still the right call here.",
        ["Thornmail"]
      )
    ).toBe(1);
  });

  it("scores 0 when response does not contain any expected reference", () => {
    expect(
      scoreConversationalContinuity("Buy Randuin's Omen for the armor.", [
        "Thornmail",
      ])
    ).toBe(0);
  });

  it("scores 1 when any one of multiple references is found", () => {
    expect(
      scoreConversationalContinuity(
        "The tank build path is still correct given the enemy comp.",
        ["tank", "Thornmail"]
      )
    ).toBe(1);
  });

  it("matches case-insensitively", () => {
    expect(
      scoreConversationalContinuity("THORNMAIL is your best option.", [
        "thornmail",
      ])
    ).toBe(1);
  });
});
