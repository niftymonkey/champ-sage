import { describe, it, expect } from "vitest";
import { AUGMENT_FIT_TASK_PROMPT } from "./prompt";

describe("AUGMENT_FIT_TASK_PROMPT", () => {
  it("tells the model to weigh granted stats against the champion's ratios and cite them", () => {
    expect(AUGMENT_FIT_TASK_PROMPT).toContain("STAT SYNERGY:");
    expect(AUGMENT_FIT_TASK_PROMPT).toContain(
      "Cite the relevant ability or ratio when one exists"
    );
  });

  it("forbids inventing a ratio citation when the profile has none", () => {
    expect(AUGMENT_FIT_TASK_PROMPT).toContain(
      "state that no matching ratio is present and do not invent one"
    );
  });
});
