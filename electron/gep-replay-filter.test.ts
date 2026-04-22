import { describe, it, expect, beforeEach } from "vitest";
import {
  AugmentReplayFilter,
  parseAugmentOfferNames,
  parseAugmentPickedName,
} from "./gep-replay-filter";

describe("parseAugmentOfferNames", () => {
  it("extracts 3 names from a stringified payload", () => {
    expect(
      parseAugmentOfferNames({
        feature: "augments",
        key: "me",
        value: JSON.stringify({
          augment_1: { name: "Magic Missile" },
          augment_2: { name: "Quest: Steel Your Heart" },
          augment_3: { name: "With Haste" },
        }),
      })
    ).toEqual(["Magic Missile", "Quest: Steel Your Heart", "With Haste"]);
  });

  it("extracts names from an already-parsed object payload", () => {
    expect(
      parseAugmentOfferNames({
        feature: "augments",
        key: "me",
        value: {
          augment_1: { name: "A" },
          augment_2: { name: "B" },
          augment_3: { name: "C" },
        },
      })
    ).toEqual(["A", "B", "C"]);
  });

  it("returns null for non-augment features", () => {
    expect(
      parseAugmentOfferNames({
        feature: "match",
        key: "me",
        value: "{}",
      })
    ).toBeNull();
  });

  it("returns null for augment updates that aren't offers", () => {
    expect(
      parseAugmentOfferNames({
        feature: "augments",
        key: "picked_augment",
        value: "Phenomenal Evil",
      })
    ).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(
      parseAugmentOfferNames({
        feature: "augments",
        key: "me",
        value: "not-valid-json",
      })
    ).toBeNull();
  });

  it("drops empty and missing names silently", () => {
    expect(
      parseAugmentOfferNames({
        feature: "augments",
        key: "me",
        value: JSON.stringify({
          augment_1: { name: "Only One" },
          augment_2: { name: "" },
          // augment_3 missing entirely
        }),
      })
    ).toEqual(["Only One"]);
  });
});

describe("parseAugmentPickedName", () => {
  it("returns the picked name", () => {
    expect(
      parseAugmentPickedName({
        feature: "augments",
        key: "picked_augment",
        value: "Celestial Body",
      })
    ).toBe("Celestial Body");
  });

  it("trims surrounding whitespace", () => {
    expect(
      parseAugmentPickedName({
        feature: "augments",
        key: "picked_augment",
        value: "  Blade Waltz  ",
      })
    ).toBe("Blade Waltz");
  });

  it("returns null for offer updates", () => {
    expect(
      parseAugmentPickedName({
        feature: "augments",
        key: "me",
        value: "{}",
      })
    ).toBeNull();
  });

  it("returns null for non-string values", () => {
    expect(
      parseAugmentPickedName({
        feature: "augments",
        key: "picked_augment",
        value: { name: "oops" },
      })
    ).toBeNull();
  });

  it("returns null for empty strings", () => {
    expect(
      parseAugmentPickedName({
        feature: "augments",
        key: "picked_augment",
        value: "   ",
      })
    ).toBeNull();
  });
});

describe("AugmentReplayFilter — Rule 1 (augment lifetime set)", () => {
  let filter: AugmentReplayFilter;

  beforeEach(() => {
    filter = new AugmentReplayFilter();
  });

  it("treats any offer as non-stale when nothing has been picked yet", () => {
    expect(filter.isStaleOffer(["A", "B", "C"])).toBe(false);
  });

  it("flags offers containing a previously-picked augment as stale", () => {
    filter.recordPick("Quest: Steel Your Heart");
    expect(
      filter.isStaleOffer([
        "Magic Missile",
        "Quest: Steel Your Heart",
        "With Haste",
      ])
    ).toBe(true);
  });

  it("does not flag an offer whose augments are all fresh", () => {
    filter.recordPick("Celestial Body");
    expect(
      filter.isStaleOffer(["Magic Missile", "Phenomenal Evil", "With Haste"])
    ).toBe(false);
  });

  it("matches names case-insensitively", () => {
    filter.recordPick("QUEST: STEEL YOUR HEART");
    expect(filter.isStaleOffer(["quest: steel your heart"])).toBe(true);
  });

  it("tolerates whitespace on both sides", () => {
    filter.recordPick("  Celestial Body  ");
    expect(filter.isStaleOffer(["Celestial Body"])).toBe(true);
  });

  it("strips HTML tags from names before matching", () => {
    filter.recordPick("Celestial Body<br>");
    expect(filter.isStaleOffer(["Celestial Body"])).toBe(true);
  });

  it("reset() forgets previous picks so the next game starts clean", () => {
    filter.recordPick("Celestial Body");
    expect(filter.isStaleOffer(["Celestial Body"])).toBe(true);
    filter.reset();
    expect(filter.isStaleOffer(["Celestial Body"])).toBe(false);
  });

  it("handles repeated picks without duplicating augment-set state", () => {
    filter.recordPick("Celestial Body");
    filter.recordPick("Celestial Body");
    expect(filter.size()).toBe(1);
  });

  it("suppresses an augment offer long after the pick (lifetime, not window)", () => {
    let now = 10_000;
    const fixed = new AugmentReplayFilter({ now: () => now });
    fixed.recordPick("Phenomenal Evil");
    // 5 minutes later a replay of the same offer still suppressed by Rule 1.
    now += 5 * 60 * 1000;
    expect(
      fixed.isStaleOffer(["Magic Missile", "Phenomenal Evil", "With Haste"])
    ).toBe(true);
  });
});

describe("AugmentReplayFilter — Rule 2 (wall-clock replay window)", () => {
  it("suppresses a shard offer that arrives within the replay window of a shard pick", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({
      now: () => now,
      replayWindowMs: 1000,
    });
    filter.recordPick("Attack Speed Shard");
    now += 10; // GEP replays pick + offer ~milliseconds apart
    expect(
      filter.isStaleOffer(["Attack Speed Shard", "Health Shard", "Armor Shard"])
    ).toBe(true);
  });

  it("does NOT suppress a shard offer that arrives after the replay window", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({
      now: () => now,
      replayWindowMs: 1000,
    });
    filter.recordPick("Attack Speed Shard");
    now += 2000; // next shard round comes 2 seconds later — legitimate, not a replay
    expect(
      filter.isStaleOffer([
        "Attack Speed Shard",
        "Lethality Shard",
        "Might Shard",
      ])
    ).toBe(false);
  });

  it("does NOT add shards to the lifetime augment set", () => {
    const filter = new AugmentReplayFilter();
    filter.recordPick("Attack Speed Shard");
    expect(filter.size()).toBe(0);
  });

  it("still records every pick's timestamp, shards included", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({
      now: () => now,
      replayWindowMs: 1000,
    });
    // Pick a shard
    filter.recordPick("Health Shard");
    // Replayed offer arrives within window
    now += 50;
    expect(
      filter.isStaleOffer(["Health Shard", "Armor Shard", "AD Shard"])
    ).toBe(true);
  });

  it("window applies to augment replays too (belt-and-suspenders alongside Rule 1)", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({
      now: () => now,
      replayWindowMs: 1000,
    });
    filter.recordPick("Phenomenal Evil");
    now += 50;
    expect(
      filter.isStaleOffer(["Magic Missile", "Phenomenal Evil", "With Haste"])
    ).toBe(true);
  });

  it("reset() clears the last-pick timestamp alongside the augment set", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({
      now: () => now,
      replayWindowMs: 1000,
    });
    filter.recordPick("Health Shard");
    filter.reset();
    now += 50;
    expect(
      filter.isStaleOffer(["Health Shard", "Armor Shard", "AD Shard"])
    ).toBe(false);
  });
});

describe("AugmentReplayFilter — real-world replay scenarios", () => {
  it("reproduces the mid-game app-relaunch shard replay", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({ now: () => now });
    // App relaunches; GEP replays the most recent pick, then its offer, ms apart.
    filter.recordPick("Attack Speed Shard");
    now += 15;
    const offerNames = ["Attack Speed Shard", "Health Shard", "Armor Shard"];
    expect(filter.isStaleOffer(offerNames)).toBe(true);
  });

  it("reproduces the launch-mid-game augment replay", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({ now: () => now });
    filter.recordPick("Quest: Steel Your Heart");
    now += 15;
    expect(
      filter.isStaleOffer([
        "Magic Missile",
        "Quest: Steel Your Heart",
        "With Haste",
      ])
    ).toBe(true);
  });

  it("allows a legitimate later shard round that shares a name with an earlier pick", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({ now: () => now });
    filter.recordPick("Unbreakable Shard");
    // 2+ minutes pass, fresh round includes a shard name that was picked earlier.
    now += 2 * 60 * 1000;
    expect(
      filter.isStaleOffer([
        "Health Shard",
        "Unbreakable Shard",
        "Attack Damage Shard",
      ])
    ).toBe(false);
  });

  it("handles shard names with stray HTML tags ('Armor Penetration Shard<br>')", () => {
    let now = 10_000;
    const filter = new AugmentReplayFilter({ now: () => now });
    filter.recordPick("Armor Penetration Shard<br>");
    now += 50;
    expect(
      filter.isStaleOffer([
        "Armor Penetration Shard",
        "Tenacity Shard",
        "Health and Size Shard",
      ])
    ).toBe(true);
    // And doesn't end up in the lifetime augment set.
    expect(filter.size()).toBe(0);
  });
});
