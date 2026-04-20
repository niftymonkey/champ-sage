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

  it("drops empty/missing names silently", () => {
    expect(
      parseAugmentOfferNames({
        feature: "augments",
        key: "me",
        value: JSON.stringify({
          augment_1: { name: "Only One" },
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

describe("AugmentReplayFilter", () => {
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

  it("reset() forgets previous picks so the next game starts clean", () => {
    filter.recordPick("Celestial Body");
    expect(filter.isStaleOffer(["Celestial Body"])).toBe(true);
    filter.reset();
    expect(filter.isStaleOffer(["Celestial Body"])).toBe(false);
  });

  it("handles repeated picks without duplicating state", () => {
    filter.recordPick("Celestial Body");
    filter.recordPick("Celestial Body");
    expect(filter.size()).toBe(1);
  });

  it("reproduces the launch-mid-game replay scenario", () => {
    // Observed sequence: app attaches mid-game; GEP replays pick then offer.
    filter.recordPick("Quest: Steel Your Heart");
    const offerNames = [
      "Magic Missile",
      "Quest: Steel Your Heart",
      "With Haste",
    ];
    expect(filter.isStaleOffer(offerNames)).toBe(true);
  });
});
