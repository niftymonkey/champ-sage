import { describe, it, expect } from "vitest";
import {
  compareUpstreamShape,
  parsePinnedVersion,
  summarizeChampions,
  summarizeItems,
  type UpstreamShape,
} from "./upstream-drift";

function baselineShape(overrides: Partial<UpstreamShape> = {}): UpstreamShape {
  return {
    ddragonVersion: "16.14.1",
    championEntries: 173,
    canonicalChampions: 173,
    variantPrefixes: [],
    itemNamespaces: { base: 429, "22": 175, "32": 26, "44": 49 },
    itemMapIds: [11, 12, 21, 30],
    maps: { "11": "Summoner's Rift", "12": "Howling Abyss" },
    queues: { "450": "ARAM", "2400": "ARAM: Mayhem" },
    ...overrides,
  };
}

describe("compareUpstreamShape", () => {
  it("reports no drift when the observed shape matches the baseline", () => {
    const findings = compareUpstreamShape(baselineShape(), baselineShape());
    expect(findings).toEqual([]);
  });

  it("ignores a version bump on its own", () => {
    // The version string changes every patch. Flagging it would make the
    // audit cry wolf on every run and train the reader to skip the output.
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({ ddragonVersion: "16.15.1" })
    );
    expect(findings).toEqual([]);
  });

  // Each of the next five would independently have caught patch 16.15.1's
  // Classic Rift roster on the day it shipped, weeks before a player noticed
  // a wrong champion name in a post-game headline.
  it("flags a champion id prefix it has never seen", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({ variantPrefixes: ["Jade"] })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("champion-variant-prefix");
    expect(findings[0].detail).toContain("Jade");
  });

  it("flags an item id namespace it has never seen", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({
        itemNamespaces: { base: 429, "22": 175, "32": 26, "44": 49, "77": 162 },
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("item-namespace");
    expect(findings[0].detail).toContain("77");
  });

  it("flags a map id it has never seen", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({ itemMapIds: [11, 12, 21, 30, 453] })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("map-id");
    expect(findings[0].detail).toContain("453");
  });

  it("flags a new queue and names it, because the name is the lead", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({
        queues: {
          "450": "ARAM",
          "2400": "ARAM: Mayhem",
          "2450": "ARAM: Mayhem Classic-ish",
        },
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("queue");
    expect(findings[0].detail).toContain("ARAM: Mayhem Classic-ish");
  });

  it("flags a champion entry count that moved", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({ championEntries: 233 })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("count");
    expect(findings[0].detail).toContain("233");
  });

  // Issue #145 shape: the ARAM catalog collapsed to ~26 items. A shrinking
  // namespace is drift just as much as a growing one, and it is the shape
  // that reaches users as "the app suddenly knows nothing".
  it("flags a namespace that shrank", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({
        itemNamespaces: { base: 429, "22": 175, "32": 4, "44": 49 },
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("count");
    expect(findings[0].detail).toContain("32");
  });

  it("flags a map that disappeared upstream", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({ itemMapIds: [11, 12, 21] })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("map-id");
    expect(findings[0].detail).toContain("30");
  });

  // The subtlest form of the 16.15.1 incident: a variant does not have to be
  // ADDED to do damage, it only has to replace a canonical champion. Total
  // entries hold steady, the prefix is already known and therefore silent, and
  // the roster the app actually keeps shrinks with nothing to show for it.
  it("flags a canonical roster that shrank behind a steady entry count", () => {
    const findings = compareUpstreamShape(
      baselineShape({ variantPrefixes: ["Jade"] }),
      baselineShape({ variantPrefixes: ["Jade"], canonicalChampions: 172 })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("count");
    expect(findings[0].detail).toContain("172");
  });

  it("flags a canonical roster that grew", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({ championEntries: 174, canonicalChampions: 174 })
    );
    expect(findings.map((f) => f.kind)).toEqual(["count", "count"]);
    expect(findings.some((f) => f.detail.includes("canonical"))).toBe(true);
  });

  it("reports every independent change rather than stopping at the first", () => {
    const findings = compareUpstreamShape(
      baselineShape(),
      baselineShape({
        championEntries: 233,
        variantPrefixes: ["Jade"],
        itemMapIds: [11, 12, 21, 30, 453],
      })
    );
    expect(findings.map((f) => f.kind).sort()).toEqual([
      "champion-variant-prefix",
      "count",
      "map-id",
    ]);
  });
});

describe("parsePinnedVersion", () => {
  it("returns undefined when no pin is requested", () => {
    expect(parsePinnedVersion(["node", "audit-upstream-drift.ts"])).toBe(
      undefined
    );
  });

  it("reads the version that follows the flag", () => {
    expect(parsePinnedVersion(["--version", "16.14.1"])).toBe("16.14.1");
  });

  // Auditing the latest patch while the caller believes they pinned an old one
  // produces a confident report about the wrong data. Fail instead.
  it("rejects a trailing --version with no value", () => {
    expect(() => parsePinnedVersion(["--update", "--version"])).toThrow(
      /--version/
    );
  });

  it("rejects a --version followed by another flag", () => {
    expect(() => parsePinnedVersion(["--version", "--update"])).toThrow(
      /--version/
    );
  });
});

describe("summarizeChampions", () => {
  const payload = {
    data: {
      Ashe: { id: "Ashe", key: "22", name: "Ashe" },
      Ryze: { id: "Ryze", key: "13", name: "Ryze" },
      Jade_Ashe: { id: "Jade_Ashe", key: "60022", name: "Ashe" },
    },
  };

  it("counts every entry and the canonical subset separately", () => {
    const summary = summarizeChampions(payload);
    expect(summary.championEntries).toBe(3);
    expect(summary.canonicalChampions).toBe(2);
  });

  it("extracts the variant prefixes so a new roster names itself", () => {
    expect(summarizeChampions(payload).variantPrefixes).toEqual(["Jade"]);
  });
});

describe("summarizeItems", () => {
  const payload = {
    data: {
      "1001": { maps: { "11": true, "12": true } },
      "223001": { maps: { "30": true } },
      "771001": { maps: { "12": true, "453": true } },
    },
  };

  it("buckets item ids by namespace", () => {
    expect(summarizeItems(payload).itemNamespaces).toEqual({
      base: 1,
      "22": 1,
      "77": 1,
    });
  });

  it("collects the map ids items are available on, sorted", () => {
    expect(summarizeItems(payload).itemMapIds).toEqual([11, 12, 30, 453]);
  });

  it("ignores map entries flagged false", () => {
    const summary = summarizeItems({
      data: { "1001": { maps: { "11": true, "21": false } } },
    });
    expect(summary.itemMapIds).toEqual([11]);
  });
});
