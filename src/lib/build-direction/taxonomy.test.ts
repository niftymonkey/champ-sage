import { describe, it, expect } from "vitest";
import {
  ALL_DIRECTIONS,
  label,
  stereotypeFromClassTag,
  type BuildDirection,
} from "./taxonomy";

describe("ALL_DIRECTIONS", () => {
  it("contains exactly the four supported directions", () => {
    expect([...ALL_DIRECTIONS].sort()).toEqual(["ad", "ap", "supp", "tank"]);
  });

  it("has length 4", () => {
    expect(ALL_DIRECTIONS).toHaveLength(4);
  });
});

describe("label", () => {
  const cases: Array<[BuildDirection, string]> = [
    ["ad", "AD"],
    ["ap", "AP"],
    ["tank", "Tank"],
    ["supp", "Support"],
  ];

  for (const [direction, expected] of cases) {
    it(`labels ${direction} as "${expected}"`, () => {
      expect(label(direction)).toBe(expected);
    });
  }
});

describe("stereotypeFromClassTag", () => {
  it("maps Marksman to ad", () => {
    expect(stereotypeFromClassTag("Marksman")).toBe("ad");
  });

  it("maps Fighter to ad", () => {
    expect(stereotypeFromClassTag("Fighter")).toBe("ad");
  });

  it("maps Assassin to ad", () => {
    expect(stereotypeFromClassTag("Assassin")).toBe("ad");
  });

  it("maps Mage to ap", () => {
    expect(stereotypeFromClassTag("Mage")).toBe("ap");
  });

  it("maps Tank to tank", () => {
    expect(stereotypeFromClassTag("Tank")).toBe("tank");
  });

  it("maps Support to supp", () => {
    expect(stereotypeFromClassTag("Support")).toBe("supp");
  });

  it("is case-insensitive", () => {
    expect(stereotypeFromClassTag("marksman")).toBe("ad");
    expect(stereotypeFromClassTag("MAGE")).toBe("ap");
  });

  it("returns null for unrecognized tags", () => {
    expect(stereotypeFromClassTag("Spectator")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(stereotypeFromClassTag("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(stereotypeFromClassTag(undefined)).toBeNull();
  });
});
