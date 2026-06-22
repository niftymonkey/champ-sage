import { describe, it, expect } from "vitest";
import { classifyStripResponse } from "./classify-strip-response";

describe("classifyStripResponse", () => {
  it("skips augment responses (they render on the badge overlay)", () => {
    expect(
      classifyStripResponse({ source: "augment", answer: "some fit text" })
    ).toEqual({ kind: "skip" });
  });

  it("skips augment responses that carry no answer, without warning", () => {
    // The regression: augment payloads have no `answer` for the strip, so the
    // no-answer guard used to fire a spurious warning before the augment skip.
    expect(classifyStripResponse({ source: "augment" })).toEqual({
      kind: "skip",
    });
  });

  it("warns on a non-augment response with no answer", () => {
    expect(classifyStripResponse({ source: "plan" })).toEqual({
      kind: "warn-no-answer",
    });
    expect(classifyStripResponse({ answer: "" })).toEqual({
      kind: "warn-no-answer",
    });
  });

  it("routes a plan response to the plan-revision card with its rev", () => {
    expect(
      classifyStripResponse({ source: "plan", answer: "do X", rev: 3 })
    ).toEqual({ kind: "plan", rev: 3, answer: "do X" });
  });

  it("defaults plan rev to 1 when the sender omits it", () => {
    expect(classifyStripResponse({ source: "plan", answer: "do X" })).toEqual({
      kind: "plan",
      rev: 1,
      answer: "do X",
    });
  });

  it("routes voice, item-rec, and unknown sources to the voice slot", () => {
    for (const source of ["reactive", "item-rec", undefined]) {
      expect(classifyStripResponse({ source, answer: "buy Zhonya's" })).toEqual(
        { kind: "voice", answer: "buy Zhonya's" }
      );
    }
  });
});
