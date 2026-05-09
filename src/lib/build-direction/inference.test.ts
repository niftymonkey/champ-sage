import { describe, it, expect } from "vitest";
import { inferEnemyDirection, type DirectionReading } from "./inference";
import type { Item } from "../data-ingest/types";
import type { BuildDirection } from "./taxonomy";

let nextId = 1;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: nextId++,
    name: `Item ${nextId}`,
    description: "",
    plaintext: "",
    gold: { base: 0, total: 0, sell: 0, purchasable: true },
    tags: [],
    stats: {},
    image: "",
    mode: "standard",
    ...overrides,
  };
}

const completedAdItem = (overrides: Partial<Item> = {}) =>
  item({
    stats: { FlatPhysicalDamageMod: 70 },
    into: [],
    ...overrides,
  });

const completedApItem = (overrides: Partial<Item> = {}) =>
  item({
    stats: { FlatMagicDamageMod: 100 },
    into: [],
    ...overrides,
  });

const completedTankItem = (overrides: Partial<Item> = {}) =>
  item({
    stats: { FlatArmorMod: 50, FlatHPPoolMod: 400 },
    into: [],
    ...overrides,
  });

const completedSuppItem = (overrides: Partial<Item> = {}) =>
  item({
    tags: ["GoldPer"],
    stats: { FlatHPPoolMod: 50 },
    into: [],
    ...overrides,
  });

const componentItem = (overrides: Partial<Item> = {}) =>
  item({
    stats: { FlatPhysicalDamageMod: 25 },
    into: [3078, 3071],
    ...overrides,
  });

describe("inferEnemyDirection — cold start", () => {
  it("returns the stereotype with stereotype confidence when no items owned", () => {
    expect(
      inferEnemyDirection({ stereotype: "ad", itemsOwned: [] })
    ).toEqual<DirectionReading>({
      direction: "ad",
      confidence: "stereotype",
    });
  });

  it("returns the stereotype with stereotype confidence when only components owned", () => {
    expect(
      inferEnemyDirection({
        stereotype: "tank",
        itemsOwned: [componentItem(), componentItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "tank",
      confidence: "stereotype",
    });
  });
});

describe("inferEnemyDirection — evidence", () => {
  it("returns ad with low confidence when one completed AD item owned", () => {
    expect(
      inferEnemyDirection({
        stereotype: "ad",
        itemsOwned: [completedAdItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "ad",
      confidence: "low",
    });
  });

  it("flips to ap when one completed AP item contradicts a tank stereotype", () => {
    expect(
      inferEnemyDirection({
        stereotype: "tank",
        itemsOwned: [completedApItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "ap",
      confidence: "low",
    });
  });

  it("returns high confidence when two completed items align", () => {
    expect(
      inferEnemyDirection({
        stereotype: "ap",
        itemsOwned: [completedApItem(), completedApItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "ap",
      confidence: "high",
    });
  });

  it("recognizes tank items by armor + HP", () => {
    expect(
      inferEnemyDirection({
        stereotype: "ad",
        itemsOwned: [completedTankItem(), completedTankItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "tank",
      confidence: "high",
    });
  });

  it("recognizes support items by gold-gen tag", () => {
    expect(
      inferEnemyDirection({
        stereotype: "ap",
        itemsOwned: [completedSuppItem(), completedSuppItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "supp",
      confidence: "high",
    });
  });

  it("ignores components, counting only completed items", () => {
    expect(
      inferEnemyDirection({
        stereotype: "tank",
        itemsOwned: [componentItem(), componentItem(), completedAdItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "ad",
      confidence: "low",
    });
  });
});

describe("inferEnemyDirection — tie-break", () => {
  it("breaks ties in favour of the stereotype, with low confidence", () => {
    // 1 ad, 1 ap, stereotype ad → ad wins but only 1 item supports it
    expect(
      inferEnemyDirection({
        stereotype: "ad",
        itemsOwned: [completedAdItem(), completedApItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "ad",
      confidence: "low",
    });
  });

  it("still breaks ties to stereotype when stereotype is the losing-tie option", () => {
    // 1 ap, 1 tank, stereotype tank → tank wins, low confidence
    expect(
      inferEnemyDirection({
        stereotype: "tank",
        itemsOwned: [completedApItem(), completedTankItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "tank",
      confidence: "low",
    });
  });

  it("returns stereotype confidence when no completed items classify into a bucket", () => {
    // Boots and plain stat-sticks pass `isCompleted` (no `into`) but
    // `bucketItem` returns null because they carry no AD/AP/tank
    // /supp signal. Treat that as "no evidence yet," not "low".
    const bootsLikeItem = item({ stats: {}, into: [] });
    expect(
      inferEnemyDirection({
        stereotype: "ap",
        itemsOwned: [bootsLikeItem, bootsLikeItem],
      })
    ).toEqual<DirectionReading>({
      direction: "ap",
      confidence: "stereotype",
    });
  });
});

describe("inferEnemyDirection — hysteresis", () => {
  it("keeps the previous direction when new candidate lacks ≥1-item lead", () => {
    // Previous: ap. Current items: 2 ap, 2 ad. Tied. Stay ap.
    expect(
      inferEnemyDirection({
        stereotype: "ap",
        itemsOwned: [
          completedApItem(),
          completedApItem(),
          completedAdItem(),
          completedAdItem(),
        ],
        previousReading: { direction: "ap", confidence: "high" },
      })
    ).toEqual<DirectionReading>({
      direction: "ap",
      confidence: "high",
    });
  });

  it("flips to a new direction when it leads previous by ≥1 item", () => {
    // Previous: ad. Current: 1 ad, 2 ap. AP leads by 1. Flip to ap.
    expect(
      inferEnemyDirection({
        stereotype: "ad",
        itemsOwned: [completedAdItem(), completedApItem(), completedApItem()],
        previousReading: { direction: "ad", confidence: "high" },
      })
    ).toEqual<DirectionReading>({
      direction: "ap",
      confidence: "high",
    });
  });

  it("ignores hysteresis on cold-start (no previousReading)", () => {
    // No previousReading; tank wins outright.
    expect(
      inferEnemyDirection({
        stereotype: "ad",
        itemsOwned: [completedTankItem(), completedTankItem()],
      })
    ).toEqual<DirectionReading>({
      direction: "tank",
      confidence: "high",
    });
  });
});

describe("inferEnemyDirection — every taxonomy direction is reachable as stereotype", () => {
  const directions: BuildDirection[] = ["ad", "ap", "tank", "supp"];
  for (const d of directions) {
    it(`returns ${d} as cold-start`, () => {
      expect(
        inferEnemyDirection({ stereotype: d, itemsOwned: [] })
      ).toEqual<DirectionReading>({
        direction: d,
        confidence: "stereotype",
      });
    });
  }
});
