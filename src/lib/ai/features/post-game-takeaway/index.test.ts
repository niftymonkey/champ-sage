import { describe, it, expect } from "vitest";
import { postGameTakeawayFeature, type PostGameTakeawayInput } from "./index";

const baseInput: PostGameTakeawayInput = {
  champion: "Lux",
  gameMode: "ARAM",
  isWin: true,
  duration: 1634,
  kills: 12,
  deaths: 4,
  assists: 18,
  finalGold: 14820,
  finalItems: ["Luden's Tempest", "Sorcerer's Shoes", "Rabadon's Deathcap"],
  recommendedBuild: [
    "Luden's Tempest",
    "Sorcerer's Shoes",
    "Rabadon's Deathcap",
    "Void Staff",
  ],
  augmentsPicked: ["Magic Missile", "With Haste"],
  voiceExchanges: [
    {
      question: "should I rush rabadons?",
      answer: "yes - their team has 0 MR",
    },
  ],
  planRevisionCount: 2,
};

describe("postGameTakeawayFeature", () => {
  it("declares post-game phase support", () => {
    expect(postGameTakeawayFeature.supportedPhases).toEqual(["post-game"]);
  });

  it("identifies as post-game-takeaway", () => {
    expect(postGameTakeawayFeature.id).toBe("post-game-takeaway");
  });

  it("user message includes champion, mode, KDA, and result", () => {
    const message = postGameTakeawayFeature.buildUserMessage(baseInput);
    expect(message).toContain("Lux");
    expect(message).toContain("ARAM");
    expect(message).toContain("victory");
    expect(message).toContain("12/4/18");
  });

  it("user message reports build alignment count", () => {
    const message = postGameTakeawayFeature.buildUserMessage(baseInput);
    expect(message).toMatch(/Matched 3 of 4 recommended items/);
  });

  it("user message names missed recommended items", () => {
    const message = postGameTakeawayFeature.buildUserMessage(baseInput);
    expect(message).toContain("Missed: Void Staff");
  });

  it("user message handles no recommended build gracefully", () => {
    const message = postGameTakeawayFeature.buildUserMessage({
      ...baseInput,
      recommendedBuild: [],
    });
    expect(message).toContain("No coach-recommended build was generated");
  });

  it("user message handles no voice questions", () => {
    const message = postGameTakeawayFeature.buildUserMessage({
      ...baseInput,
      voiceExchanges: [],
    });
    expect(message).toContain("No voice questions asked");
  });

  it("user message handles defeat result", () => {
    const message = postGameTakeawayFeature.buildUserMessage({
      ...baseInput,
      isWin: false,
    });
    expect(message).toContain("defeat");
  });

  it("summarizeForHistory returns the narrative", () => {
    const summary = postGameTakeawayFeature.summarizeForHistory({
      narrative: "The plan held up early.",
    });
    expect(summary).toBe("The plan held up early.");
  });

  it("extractResult is identity", () => {
    const result = { narrative: "x" };
    expect(postGameTakeawayFeature.extractResult(result)).toBe(result);
  });

  it("user message includes the declared build direction when set", () => {
    const message = postGameTakeawayFeature.buildUserMessage({
      ...baseInput,
      playerBuildDirection: "ap",
    });
    expect(message).toContain("Build direction declared: AP");
  });

  it("user message omits build direction when not declared", () => {
    const message = postGameTakeawayFeature.buildUserMessage({
      ...baseInput,
      playerBuildDirection: null,
    });
    expect(message).not.toContain("Build direction declared");
  });
});
