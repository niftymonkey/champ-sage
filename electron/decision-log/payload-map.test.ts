import { describe, it, expect } from "vitest";
import {
  coachingPayloadToDecisionInput,
  type CoachingResponsePayload,
} from "./payload-map";

const baseGameFields = {
  gameId: "G1",
  gameMode: "ARAM",
};

describe("coachingPayloadToDecisionInput", () => {
  it("returns null when gameId is missing", () => {
    const result = coachingPayloadToDecisionInput({
      source: "plan",
      answer: "x",
    });
    expect(result).toBeNull();
  });

  it("normalizes lowercase / unfamiliar gameMode strings to enum values", () => {
    expect(
      coachingPayloadToDecisionInput({
        ...baseGameFields,
        gameMode: "aram",
        source: "reactive",
        answer: "x",
      })?.gameMode
    ).toBe("ARAM");

    expect(
      coachingPayloadToDecisionInput({
        ...baseGameFields,
        gameMode: "PRACTICETOOL",
        source: "reactive",
        answer: "x",
      })?.gameMode
    ).toBe("PRACTICETOOL");

    expect(
      coachingPayloadToDecisionInput({
        ...baseGameFields,
        gameMode: "OTHER_MODE",
        source: "reactive",
        answer: "x",
      })?.gameMode
    ).toBe("OTHER");
  });

  it("maps source=plan with rev and buildPath", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "plan",
      answer: "open with luden's",
      rev: 2,
      buildPath: [
        {
          name: "Luden's",
          category: "core",
          targetEnemy: null,
          reason: "burst",
        },
      ],
    });
    expect(result?.source).toBe("plan");
    if (result?.source !== "plan") throw new Error();
    expect(result.rev).toBe(2);
    expect(result.buildPath[0].name).toBe("Luden's");
  });

  it("defaults plan rev to 1 when missing", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "plan",
      answer: "x",
    });
    if (result?.source !== "plan") throw new Error();
    expect(result.rev).toBe(1);
  });

  it("maps source=augment with recommendations and the constructed question", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "augment",
      answer: "",
      question: "I'm being offered: A, B, C.",
      recommendations: [{ name: "A", fit: "strong", reasoning: "synergy" }],
    });
    expect(result?.source).toBe("augment");
    if (result?.source !== "augment") throw new Error();
    expect(result.question).toMatch(/A, B, C/);
    expect(result.recommendations).toHaveLength(1);
  });

  it("maps source=item-rec with question, answer, and recommendations", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "item-rec",
      question: "what next?",
      answer: "rabadons",
      recommendations: [
        { name: "Rabadon's", fit: "exceptional", reasoning: "ap shop" },
      ],
    });
    expect(result?.source).toBe("item-rec");
    if (result?.source !== "item-rec") throw new Error();
    expect(result.question).toBe("what next?");
    expect(result.answer).toBe("rabadons");
    expect(result.recommendations).toHaveLength(1);
  });

  it("maps source=reactive to a voice decision", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "reactive",
      question: "armor or MR?",
      answer: "armor",
    });
    expect(result?.source).toBe("voice");
    if (result?.source !== "voice") throw new Error();
    expect(result.question).toBe("armor or MR?");
    expect(result.answer).toBe("armor");
  });

  it("propagates retried=true verbatim", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "reactive",
      answer: "x",
      retried: true,
    });
    expect(result?.retried).toBe(true);
  });

  it("retried is false when payload omits the field", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      source: "reactive",
      answer: "x",
    });
    expect(result?.retried).toBe(false);
  });

  it("returns null for unknown source values", () => {
    const result = coachingPayloadToDecisionInput({
      ...baseGameFields,
      // @ts-expect-error — testing runtime guard for unknown source
      source: "rogue",
      answer: "x",
    });
    expect(result).toBeNull();
  });
});
