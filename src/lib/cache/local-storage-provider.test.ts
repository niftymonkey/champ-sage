import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localStorageProvider, CACHE_STORAGE_KEY } from "./local-storage-provider";

describe("localStorageProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("hydrates the cache from a populated storage key", () => {
    // SWR stores State<Data> objects keyed by string. Tests seed the
    // same shape the runtime would write.
    const seed: Array<[string, unknown]> = [
      ["match-history", { data: [{ gameId: "1", championName: "Lux" }] }],
      ["other-key", { data: { foo: "bar" } }],
    ];
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(seed));

    const cache = localStorageProvider();

    expect(cache.get("match-history")).toEqual({
      data: [{ gameId: "1", championName: "Lux" }],
    });
    expect(cache.get("other-key")).toEqual({ data: { foo: "bar" } });
  });

  it("persists writes through to localStorage on set", () => {
    const cache = localStorageProvider();
    cache.set("match-history", {
      data: [{ gameId: "42", championName: "Ashe" }],
    });

    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Array<[string, unknown]>;
    expect(parsed).toContainEqual([
      "match-history",
      { data: [{ gameId: "42", championName: "Ashe" }] },
    ]);
  });

  it("persists writes through to localStorage on delete", () => {
    const seed: Array<[string, unknown]> = [
      ["match-history", { data: [1, 2, 3] }],
    ];
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(seed));

    const cache = localStorageProvider();
    cache.delete("match-history");

    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Array<[string, unknown]>;
    expect(parsed.find(([k]) => k === "match-history")).toBeUndefined();
  });

  it("degrades to in-memory when localStorage holds corrupt JSON", () => {
    localStorage.setItem(CACHE_STORAGE_KEY, "{not-valid-json");

    const cache = localStorageProvider();
    expect(cache.get("match-history")).toBeUndefined();

    cache.set("match-history", { data: ["ok"] });
    expect(cache.get("match-history")).toEqual({ data: ["ok"] });
  });

  it("swallows quota-exceeded errors on set", () => {
    const cache = localStorageProvider();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      () => {
        throw new Error("QuotaExceededError");
      }
    );

    expect(() =>
      cache.set("match-history", { data: [1, 2, 3] })
    ).not.toThrow();
    expect(cache.get("match-history")).toEqual({ data: [1, 2, 3] });

    setItem.mockRestore();
  });

  it("supports iterating keys for SWR's mutate() predicate", () => {
    const seed: Array<[string, unknown]> = [
      ["match-history", { data: [] }],
      ["$req$match-history", { data: {} }],
      ["other", { data: {} }],
    ];
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(seed));

    const cache = localStorageProvider();
    const keys = Array.from(cache.keys());
    expect(keys).toContain("match-history");
    expect(keys).toContain("$req$match-history");
    expect(keys).toContain("other");
  });
});
