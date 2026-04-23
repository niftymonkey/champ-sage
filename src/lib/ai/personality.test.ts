import { describe, expect, it } from "vitest";
import {
  briefPersonality,
  noopPersonality,
  piratePersonality,
  type PersonalityLayer,
} from "./personality";

describe("personality", () => {
  it("noopPersonality returns an empty suffix (structural fallback only)", () => {
    expect(noopPersonality.id).toBe("no-op");
    expect(noopPersonality.suffix()).toBe("");
  });

  it("briefPersonality carries the brevity / lead-with-rec voice rules", () => {
    expect(briefPersonality.id).toBe("brief");
    const suffix = briefPersonality.suffix();
    expect(suffix).toContain("RESPONSE RULES:");
    expect(suffix).toContain("1-3 sentences maximum");
    expect(suffix).toContain("Lead with your top recommendation");
  });

  it("piratePersonality has a distinctive vocabulary signature", () => {
    expect(piratePersonality.id).toBe("pirate");
    const suffix = piratePersonality.suffix();
    expect(suffix).toContain("pirate");
    expect(suffix).toContain("arr");
    expect(suffix).toContain("matey");
  });

  it("custom personalities implement the same shape", () => {
    const custom: PersonalityLayer = {
      id: "custom",
      suffix: () => "custom voice rules",
    };
    expect(custom.id).toBe("custom");
    expect(custom.suffix()).toBe("custom voice rules");
  });
});
