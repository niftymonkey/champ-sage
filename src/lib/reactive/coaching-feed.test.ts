import { describe, it, expect, beforeEach } from "vitest";
import {
  coachingFeed$,
  gamePlan$,
  lastGameSnapshot$,
  pushGamePlan,
  pushAugmentOffer,
  markAugmentPicked,
  pushVoiceCoaching,
  captureLastGameSnapshot,
  resetForNewGame,
  _resetFeedIdCounter,
} from "./coaching-feed";

beforeEach(() => {
  resetForNewGame();
  _resetFeedIdCounter();
  lastGameSnapshot$.next(null);
});

describe("coachingFeed$", () => {
  it("starts empty", () => {
    expect(coachingFeed$.getValue()).toEqual([]);
  });

  it("accumulates entries in chronological order", () => {
    pushGamePlan("Plan A", ["Item1", "Item2"], 10);
    pushVoiceCoaching("question?", "answer", [], 30);
    pushAugmentOffer([{ name: "Aug1", rank: 1, reasoning: "good" }], 45);

    const feed = coachingFeed$.getValue();
    expect(feed).toHaveLength(3);
    expect(feed[0].type).toBe("game-plan");
    expect(feed[1].type).toBe("voice-coaching");
    expect(feed[2].type).toBe("augment-offer");
    expect(feed[0].timestamp).toBe(10);
    expect(feed[1].timestamp).toBe(30);
    expect(feed[2].timestamp).toBe(45);
  });

  it("assigns unique IDs to each entry", () => {
    pushGamePlan("Plan", [], 0);
    pushVoiceCoaching("q", "a", [], 10);
    pushAugmentOffer([], 20);

    const ids = coachingFeed$.getValue().map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("pushGamePlan", () => {
  it("creates a proactive game-plan entry in the feed", () => {
    const entry = pushGamePlan(
      "Heavy CC comp",
      [
        "Rocketbelt",
        "Merc Treads",
        "Zhonya's",
        "Banshee's",
        "Rabadon's",
        "Void Staff",
      ],
      12
    );

    expect(entry.type).toBe("game-plan");
    expect(entry.proactive).toBe(true);
    expect(entry.summary).toBe("Heavy CC comp");
    expect(entry.buildPath).toHaveLength(6);
    expect(entry.timestamp).toBe(12);
  });

  it("updates gamePlan$ with the current plan", () => {
    pushGamePlan("Initial plan", ["A", "B", "C", "D", "E", "F"], 10);

    const plan = gamePlan$.getValue();
    expect(plan).not.toBeNull();
    expect(plan!.summary).toBe("Initial plan");
    expect(plan!.buildPath).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(plan!.updatedAt).toBe(10);
  });

  it("replaces the previous plan when called again", () => {
    pushGamePlan("Plan v1", ["A", "B", "C", "D", "E", "F"], 10);
    pushGamePlan("Plan v2", ["X", "Y", "Z", "W", "V", "U"], 300);

    const plan = gamePlan$.getValue();
    expect(plan!.summary).toBe("Plan v2");
    expect(plan!.updatedAt).toBe(300);

    // Both entries should be in the feed
    expect(coachingFeed$.getValue()).toHaveLength(2);
  });
});

describe("pushAugmentOffer", () => {
  it("creates a proactive augment-offer entry", () => {
    const entry = pushAugmentOffer(
      [
        { name: "Phenomenal Evil", rank: 1, reasoning: "Best scaling" },
        { name: "Recursion", rank: 2, reasoning: "Decent" },
        { name: "Firebrand", rank: 3, reasoning: "Redundant" },
      ],
      180
    );

    expect(entry.type).toBe("augment-offer");
    expect(entry.proactive).toBe(true);
    expect(entry.options).toHaveLength(3);
    expect(entry.picked).toBeUndefined();
  });
});

describe("markAugmentPicked", () => {
  it("sets picked on the matching augment offer", () => {
    const entry = pushAugmentOffer(
      [{ name: "Phenomenal Evil", rank: 1, reasoning: "Best" }],
      100
    );

    markAugmentPicked(entry.id, "Phenomenal Evil");

    const feed = coachingFeed$.getValue();
    const updated = feed.find((e) => e.id === entry.id);
    expect(updated).toBeDefined();
    expect((updated as any).picked).toBe("Phenomenal Evil");
  });

  it("does not affect other entries", () => {
    pushVoiceCoaching("q", "a", [], 50);
    const aug = pushAugmentOffer(
      [{ name: "Aug1", rank: 1, reasoning: "good" }],
      100
    );
    pushVoiceCoaching("q2", "a2", [], 150);

    markAugmentPicked(aug.id, "Aug1");

    const feed = coachingFeed$.getValue();
    expect(feed[0].type).toBe("voice-coaching");
    expect(feed[2].type).toBe("voice-coaching");
    expect((feed[1] as any).picked).toBe("Aug1");
  });
});

describe("pushVoiceCoaching", () => {
  it("creates a reactive voice-coaching entry", () => {
    const entry = pushVoiceCoaching(
      "What should I build?",
      "Build Zhonya's",
      [{ name: "Zhonya's Hourglass", reasoning: "Anti-burst" }],
      200
    );

    expect(entry.type).toBe("voice-coaching");
    expect(entry.proactive).toBe(false);
    expect(entry.question).toBe("What should I build?");
    expect(entry.answer).toBe("Build Zhonya's");
    expect(entry.recommendations).toHaveLength(1);
  });
});

describe("captureLastGameSnapshot", () => {
  it("stores the snapshot in lastGameSnapshot$", () => {
    captureLastGameSnapshot({
      championName: "Katarina",
      isWin: true,
      kills: 12,
      deaths: 4,
      assists: 15,
      gameTime: 1592,
      gameMode: "ARAM Mayhem",
      items: [
        "Rocketbelt",
        "Merc Treads",
        "Zhonya's",
        "Banshee's",
        "Rabadon's",
        "Shadowflame",
      ],
      augments: ["Phenomenal Evil", "Mystic Punch"],
      recentExchanges: [
        { question: "What should I build?", answer: "Build Zhonya's" },
      ],
    });

    const snapshot = lastGameSnapshot$.getValue();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.championName).toBe("Katarina");
    expect(snapshot!.isWin).toBe(true);
    expect(snapshot!.items).toHaveLength(6);
    expect(snapshot!.recentExchanges).toHaveLength(1);
  });
});

describe("resetForNewGame", () => {
  it("clears the feed and plan but preserves last game snapshot", () => {
    pushGamePlan("Plan", ["A", "B", "C", "D", "E", "F"], 10);
    pushVoiceCoaching("q", "a", [], 50);
    captureLastGameSnapshot({
      championName: "Katarina",
      isWin: true,
      kills: 8,
      deaths: 3,
      assists: 12,
      gameTime: 1200,
      gameMode: "ARAM Mayhem",
      items: [],
      augments: [],
      recentExchanges: [],
    });

    resetForNewGame();

    expect(coachingFeed$.getValue()).toEqual([]);
    expect(gamePlan$.getValue()).toBeNull();
    expect(lastGameSnapshot$.getValue()).not.toBeNull();
  });
});
