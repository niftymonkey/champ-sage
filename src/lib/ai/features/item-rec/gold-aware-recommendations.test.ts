import { describe, it, expect } from "vitest";
import { scoreGoldAwareRecommendations } from "./scorers";

describe("scoreGoldAwareRecommendations", () => {
  // --- N/A cases ---

  it("returns 1 when gold is 0", () => {
    expect(
      scoreGoldAwareRecommendations(
        "You need to farm up before buying anything.",
        0,
        "What should I buy?"
      )
    ).toBe(1);
  });

  it("returns 1 when response has no purchase verbs (strategic advice)", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Focus on peeling for your carry in teamfights.",
        1500,
        "How should I play teamfights?"
      )
    ).toBe(1);
  });

  it("returns 1 when response mentions items without purchase verbs", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Rabadon's gives you a big AP spike for teamfights. Focus on positioning.",
        1500,
        "How do I deal with their Katarina?"
      )
    ).toBe(1);
  });

  it("returns 1 for augment confirmation questions", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Good choice. Build toward Sunfire Aegis next.",
        1500,
        "I chose Demon's Dance."
      )
    ).toBe(1);
  });

  it("returns 1 for augment offer questions listing options", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Pick Shrink Engine. Rush Thornmail after.",
        1500,
        "shrink engine, sole eater, or red envelopes."
      )
    ).toBe(1);
  });

  it("returns 1 for augment confirmation with 'picked'", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Nice. Rush Thornmail for anti-heal.",
        1200,
        "I picked Overflow."
      )
    ).toBe(1);
  });

  // --- Passing cases ---

  it("returns 1 when response has destination and component (can afford)", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now.",
        1500,
        "What should I buy next?"
      )
    ).toBe(1);
  });

  it("returns 1 when response has destination and component (can't afford)", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod at 1250g.",
        200,
        "What item should I buy?"
      )
    ).toBe(1);
  });

  it("returns 1 when response uses 'build toward' with bold formatting", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Build toward **Rabadon's Deathcap**. You can get a **Needlessly Large Rod** now.",
        1500,
        "What should I build next?"
      )
    ).toBe(1);
  });

  it("returns 1 when response uses 'pick up' as component verb", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Build toward Infinity Edge. Pick up a B.F. Sword now.",
        1500,
        "What item should I buy?"
      )
    ).toBe(1);
  });

  it("returns 1 when response uses 'grab' as component verb", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Build toward Sunfire Aegis. Grab a Bami's Cinder now.",
        1500,
        "What should I buy next?"
      )
    ).toBe(1);
  });

  // --- Failing cases ---

  it("returns 0 when response says 'buy' but has no destination", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Buy Needlessly Large Rod now.",
        1500,
        "What item should I buy?"
      )
    ).toBe(0);
  });

  it("returns 0 when response has destination but no component", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Build toward Rabadon's Deathcap.",
        1500,
        "What should I buy next?"
      )
    ).toBe(0);
  });

  it("returns 0 when response says 'rush' but has no destination pattern", () => {
    expect(
      scoreGoldAwareRecommendations(
        "Rush Needlessly Large Rod for the AP spike.",
        1500,
        "What item should I buy?"
      )
    ).toBe(0);
  });
});
