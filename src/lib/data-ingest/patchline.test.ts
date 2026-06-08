import { describe, it, expect } from "vitest";
import { cdragonBranch, patchlineCacheKey } from "./patchline";

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
