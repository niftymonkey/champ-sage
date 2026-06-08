import { describe, it, expect } from "vitest";
import {
  cdragonBranch,
  patchlineCacheKey,
  patchlineFromRegion,
} from "./patchline";

describe("cdragonBranch", () => {
  it("maps live to the latest CDragon branch", () => {
    expect(cdragonBranch("live")).toBe("latest");
  });

  it("maps pbe to the pbe CDragon branch", () => {
    expect(cdragonBranch("pbe")).toBe("pbe");
  });
});

describe("patchlineCacheKey", () => {
  it("namespaces the cache key per patchline", () => {
    expect(patchlineCacheKey("live")).toBe("game-data:live");
    expect(patchlineCacheKey("pbe")).toBe("game-data:pbe");
  });

  it("produces distinct keys so live and pbe data coexist", () => {
    expect(patchlineCacheKey("live")).not.toBe(patchlineCacheKey("pbe"));
  });
});

describe("patchlineFromRegion", () => {
  it("maps the PBE region to the pbe patchline", () => {
    expect(patchlineFromRegion("PBE")).toBe("pbe");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(patchlineFromRegion(" pbe ")).toBe("pbe");
  });

  it("maps any live shard to the live patchline", () => {
    expect(patchlineFromRegion("NA")).toBe("live");
    expect(patchlineFromRegion("EUW")).toBe("live");
    expect(patchlineFromRegion("")).toBe("live");
  });
});
