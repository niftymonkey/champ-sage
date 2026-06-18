import { describe, it, expect } from "vitest";
import { parseModesArg } from "./collection-args";

const VALID = ["aram", "ranked-solo", "arena"] as const;

describe("parseModesArg", () => {
  it("returns null when --modes is absent (caller keeps default)", () => {
    expect(parseModesArg(["--test"], VALID)).toBeNull();
  });

  it("parses a comma-separated --modes=value form", () => {
    expect(parseModesArg(["--modes=aram,arena"], VALID)).toEqual([
      "aram",
      "arena",
    ]);
  });

  it("parses the space-separated --modes value form", () => {
    expect(parseModesArg(["--modes", "ranked-solo"], VALID)).toEqual([
      "ranked-solo",
    ]);
  });

  it("drops unknown modes, keeping only valid ones", () => {
    expect(parseModesArg(["--modes=aram,bogus,arena"], VALID)).toEqual([
      "aram",
      "arena",
    ]);
  });

  it("trims whitespace around mode names", () => {
    expect(parseModesArg(["--modes=aram, arena"], VALID)).toEqual([
      "aram",
      "arena",
    ]);
  });

  it("returns an empty array when all requested modes are invalid", () => {
    expect(parseModesArg(["--modes=bogus"], VALID)).toEqual([]);
  });
});
