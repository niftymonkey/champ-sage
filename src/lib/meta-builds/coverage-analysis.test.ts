import { describe, it, expect } from "vitest";
import {
  mulberry32,
  completedItems,
  itemPresence,
  topKItems,
  jaccard,
  subsample,
  convergenceCurve,
  diversityCurve,
  type CoverageParticipant,
} from "./coverage-analysis";

function p(
  championId: number,
  puuid: string,
  items: number[]
): CoverageParticipant {
  return { championId, championName: `C${championId}`, puuid, items };
}

describe("mulberry32", () => {
  it("is deterministic for a seed and advances (not constant)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB); // same seed, same sequence
    expect(seqA[0]).not.toBe(seqA[1]); // a real PRNG advances
  });

  it("produces floats in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("completedItems", () => {
  it("keeps slots 0-5 real items, drops zeros and the trinket slot", () => {
    // slots: [3031, 0, 3094, 0, 0, 0, 3340(trinket)]
    expect(completedItems([3031, 0, 3094, 0, 0, 0, 3340])).toEqual([
      3031, 3094,
    ]);
  });

  it("dedupes and sorts ascending", () => {
    expect(completedItems([3094, 3031, 3094, 0, 0, 0, 0])).toEqual([
      3031, 3094,
    ]);
  });
});

describe("itemPresence", () => {
  it("counts how many participants built each item", () => {
    const parts = [
      p(1, "a", [10, 20, 0, 0, 0, 0, 0]),
      p(1, "b", [10, 30, 0, 0, 0, 0, 0]),
      p(1, "c", [10, 20, 0, 0, 0, 0, 0]),
    ];
    const pres = itemPresence(parts);
    expect(pres.get(10)).toBe(3);
    expect(pres.get(20)).toBe(2);
    expect(pres.get(30)).toBe(1);
  });
});

describe("topKItems", () => {
  it("returns the k most-built items, desc by count, ties by id asc", () => {
    const parts = [
      p(1, "a", [10, 20, 30, 0, 0, 0, 0]),
      p(1, "b", [10, 20, 40, 0, 0, 0, 0]),
      p(1, "c", [10, 50, 0, 0, 0, 0, 0]),
    ];
    // counts: 10->3, 20->2, 30->1,40->1,50->1 ; top3 = [10,20, then id-asc 30]
    expect(topKItems(parts, 3)).toEqual([10, 20, 30]);
  });

  it("returns all items when fewer than k exist", () => {
    const parts = [p(1, "a", [10, 20, 0, 0, 0, 0, 0])];
    expect(topKItems(parts, 5).sort((x, y) => x - y)).toEqual([10, 20]);
  });
});

describe("jaccard", () => {
  it("computes intersection over union", () => {
    expect(jaccard([1, 2, 3], [2, 3, 4])).toBeCloseTo(0.5, 10);
  });
  it("is 1 for identical sets and for two empty sets", () => {
    expect(jaccard([1, 2], [2, 1])).toBe(1);
    expect(jaccard([], [])).toBe(1);
  });
  it("is 0 for disjoint sets", () => {
    expect(jaccard([1], [2])).toBe(0);
  });
});

describe("subsample", () => {
  it("returns exactly n distinct elements from the array", () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out = subsample(arr, 4, mulberry32(1));
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
    for (const v of out) expect(arr).toContain(v);
  });

  it("is deterministic for the same seed", () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out1 = subsample(arr, 5, mulberry32(99));
    expect(out1).toHaveLength(5);
    expect(out1).toEqual(subsample(arr, 5, mulberry32(99)));
  });

  it("returns the whole array (in some order) when n >= length", () => {
    const arr = [1, 2, 3];
    expect(subsample(arr, 9, mulberry32(3)).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("convergenceCurve", () => {
  it("is a perfect 1.0 at every N when all participants build identically", () => {
    // No variance => any subsample's pool equals the ground-truth pool.
    const parts = Array.from({ length: 200 }, (_, i) =>
      p(1, `u${i}`, [10, 20, 30, 40, 0, 0, 0])
    );
    const curve = convergenceCurve(parts, [10, 40, 100], 4, 5, mulberry32(5));
    expect(curve.map((c) => c.x)).toEqual([10, 40, 100]);
    for (const point of curve) expect(point.meanJaccard).toBeCloseTo(1, 10);
  });

  it("skips Ns larger than the population", () => {
    const parts = Array.from({ length: 30 }, (_, i) =>
      p(1, `u${i}`, [10, 20, 0, 0, 0, 0, 0])
    );
    const curve = convergenceCurve(parts, [10, 50], 2, 3, mulberry32(1));
    expect(curve.map((c) => c.x)).toEqual([10]); // 50 > 30, skipped
  });
});

describe("diversityCurve", () => {
  it("recovers the ground-truth pool when all players build identically, at every m", () => {
    // 40 players x 10 games each, identical builds: concentration cannot change
    // the pool, and low-m draws are feasible (m=2 players supply >= 20 games).
    const parts: CoverageParticipant[] = [];
    for (let u = 0; u < 40; u++) {
      for (let g = 0; g < 10; g++)
        parts.push(p(1, `u${u}`, [10, 20, 30, 0, 0, 0, 0]));
    }
    const curve = diversityCurve(parts, 20, [2, 5, 20], 3, 5, mulberry32(2));
    expect(curve.map((c) => c.x)).toEqual([2, 5, 20]);
    for (const point of curve) {
      expect(point.samples).toBeGreaterThan(0);
      expect(point.meanJaccard).toBeCloseTo(1, 10);
    }
  });
});
