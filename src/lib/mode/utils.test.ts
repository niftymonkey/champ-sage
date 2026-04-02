import { describe, it, expect } from "vitest";
import { filterItemsByMode, filterAugmentsByMode } from "./utils";
import type { Augment, Item } from "../data-ingest/types";

function makeItem(id: number, mode: string): Item {
  return {
    id,
    name: `Item ${id}`,
    description: "",
    plaintext: "",
    gold: { base: 100, total: 100, sell: 70, purchasable: true },
    tags: [],
    stats: {},
    image: "",
    mode: mode as Item["mode"],
  };
}

function makeAugment(name: string, mode: string): Augment {
  return {
    name,
    description: "",
    tier: "Silver",
    sets: [],
    mode: mode as Augment["mode"],
  };
}

describe("filterItemsByMode", () => {
  it("returns only items matching the given mode", () => {
    const items = new Map<number, Item>([
      [1, makeItem(1, "aram")],
      [2, makeItem(2, "standard")],
      [3, makeItem(3, "aram")],
    ]);

    const result = filterItemsByMode(items, "aram");

    expect(result.size).toBe(2);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has(2)).toBe(false);
  });

  it("returns empty map when no items match", () => {
    const items = new Map<number, Item>([[1, makeItem(1, "standard")]]);

    const result = filterItemsByMode(items, "arena");

    expect(result.size).toBe(0);
  });

  it("works with arena mode", () => {
    const items = new Map<number, Item>([
      [1, makeItem(1, "arena")],
      [2, makeItem(2, "aram")],
      [3, makeItem(3, "arena")],
    ]);

    const result = filterItemsByMode(items, "arena");

    expect(result.size).toBe(2);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
  });

  it("returns empty map for empty input", () => {
    const result = filterItemsByMode(new Map(), "aram");
    expect(result.size).toBe(0);
  });
});

describe("filterAugmentsByMode", () => {
  it("returns only augments matching the given mode", () => {
    const augments = new Map<string, Augment>([
      ["a", makeAugment("Typhoon", "mayhem")],
      ["b", makeAugment("Blade Waltz", "arena")],
      ["c", makeAugment("Storm", "mayhem")],
    ]);

    const result = filterAugmentsByMode(augments, "mayhem");

    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("c")).toBe(true);
    expect(result.has("b")).toBe(false);
  });

  it("returns empty map when no augments match", () => {
    const augments = new Map<string, Augment>([
      ["a", makeAugment("Typhoon", "mayhem")],
    ]);

    const result = filterAugmentsByMode(augments, "arena");

    expect(result.size).toBe(0);
  });

  it("works with arena mode", () => {
    const augments = new Map<string, Augment>([
      ["a", makeAugment("Blade Waltz", "arena")],
      ["b", makeAugment("Typhoon", "mayhem")],
      ["c", makeAugment("Shield Bash", "arena")],
    ]);

    const result = filterAugmentsByMode(augments, "arena");

    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  it("returns empty map for empty input", () => {
    const result = filterAugmentsByMode(new Map(), "mayhem");
    expect(result.size).toBe(0);
  });
});
