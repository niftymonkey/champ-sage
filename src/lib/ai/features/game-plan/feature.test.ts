import { describe, it, expect } from "vitest";
import { createGamePlanFeature } from "./index";
import { aramMode } from "../../../mode";
import type { LoadedGameData } from "../../../data-ingest";
import type { Item, ItemMode } from "../../../data-ingest/types";

function item(
  id: number,
  name: string,
  mode: ItemMode,
  overrides: Partial<Item> = {}
): Item {
  return {
    id,
    name,
    description: "",
    plaintext: "",
    gold: { base: 0, total: 3000, sell: 0, purchasable: true },
    tags: [],
    stats: {},
    image: "",
    mode,
    ...overrides,
  };
}

function makeGameData(items: Item[]): LoadedGameData {
  return {
    version: "test",
    champions: new Map(),
    items: new Map(items.map((i) => [i.id, i])),
    runes: [],
    augments: new Map(),
    augmentSets: [],
    dictionary: {
      allNames: [],
      champions: [],
      items: [],
      augments: [],
      search: () => [],
      findInText: () => [],
    },
  };
}

interface SchemaNode {
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: string[];
}

function buildPathNameEnum(
  feature: ReturnType<typeof createGamePlanFeature>
): string[] | undefined {
  // outputSchema is the AI SDK's FlexibleSchema union; the concrete value here
  // is a jsonSchema() result whose raw schema lives under `.jsonSchema`.
  const wrapped = feature.outputSchema as unknown as { jsonSchema: SchemaNode };
  return wrapped.jsonSchema.properties?.buildPath?.items?.properties?.name
    ?.enum;
}

describe("createGamePlanFeature", () => {
  // The buildPath name enum must restrict to build-path-eligible items for the
  // mode: completed, purchasable, non-consumable, mode-available. This both
  // re-enables name validation (the full catalog exceeds the 500-value enum cap
  // and silently disables it) and structurally rules out consumables and
  // off-mode items (issue #127).
  it("restricts the buildPath name enum to mode-eligible itemization", () => {
    const gameData = makeGameData([
      item(1, "On-Hit Standard Item", "standard"),
      item(2, "Poro-Snax", "aram", {
        tags: ["Consumable"],
        gold: { base: 0, total: 50, sell: 0, purchasable: true },
      }),
      item(3, "Arena Only Item", "arena"),
    ]);

    const nameEnum = buildPathNameEnum(
      createGamePlanFeature(gameData, aramMode)
    );

    expect(nameEnum).toContain("On-Hit Standard Item");
    expect(nameEnum).not.toContain("Poro-Snax");
    expect(nameEnum).not.toContain("Arena Only Item");
  });
});
