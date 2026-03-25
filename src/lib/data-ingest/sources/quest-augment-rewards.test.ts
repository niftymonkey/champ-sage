import { describe, it, expect } from "vitest";
import type { Augment, Item } from "../types";
import { enrichQuestAugments } from "./quest-augment-rewards";

function makeAugment(
  name: string,
  description: string,
  overrides?: Partial<Augment>
): Augment {
  return {
    name,
    description,
    tier: "Prismatic",
    sets: [],
    mode: "mayhem",
    ...overrides,
  };
}

function makeItem(name: string, stats: Record<string, number>): Item {
  return {
    id: 1,
    name,
    description: "",
    plaintext: "",
    gold: { base: 0, total: 0, sell: 0, purchasable: false },
    tags: [],
    stats,
    image: "",
    mode: "standard",
  };
}

function buildItemsMap(items: Item[]): Map<number, Item> {
  const map = new Map<number, Item>();
  items.forEach((item, i) => {
    item.id = i + 1;
    map.set(item.id, item);
  });
  return map;
}

describe("enrichQuestAugments", () => {
  const goldenSpatula = makeItem("The Golden Spatula", {
    FlatPhysicalDamageMod: 90,
    FlatMagicDamageMod: 125,
    PercentAttackSpeedMod: 0.6,
    FlatCritChanceMod: 0.25,
    FlatHPPoolMod: 250,
    FlatArmorMod: 30,
    FlatSpellBlockMod: 30,
    FlatMPPoolMod: 250,
    PercentMovementSpeedMod: 0.1,
  });

  const voidImmolation = makeItem("Void Immolation", {
    FlatHPPoolMod: 1000,
    FlatArmorMod: 100,
    FlatSpellBlockMod: 80,
  });

  const woogletsWitchcap = makeItem("Wooglet's Witchcap", {
    FlatMagicDamageMod: 300,
    FlatArmorMod: 50,
  });

  it("dynamically appends reward item stats from the items database", () => {
    const augments = new Map<string, Augment>();
    augments.set(
      "quest: urf's champion",
      makeAugment(
        "Quest: Urf's Champion",
        "Quest: Score 18 champion takedowns. Reward: Upon completing your Quest, you receive The Golden Spatula."
      )
    );

    const items = buildItemsMap([goldenSpatula]);
    enrichQuestAugments(augments, items);

    const result = augments.get("quest: urf's champion")!;
    expect(result.description).toContain("90 Attack Damage");
    expect(result.description).toContain("125 Ability Power");
    expect(result.description).toContain("60% Attack Speed");
    expect(result.description).toContain("250 Health");
  });

  it("appends stats for Void Immolation from items database", () => {
    const augments = new Map<string, Augment>();
    augments.set(
      "quest: icathia's fall",
      makeAugment(
        "Quest: Icathia's Fall",
        "Gain Bami's Cinder. Quest: Obtain Hollow Radiance and Sunfire Aegis. Reward: Upon completing your Quest, convert the items into Void Immolation."
      )
    );

    const items = buildItemsMap([voidImmolation]);
    enrichQuestAugments(augments, items);

    const result = augments.get("quest: icathia's fall")!;
    expect(result.description).toContain("1000 Health");
    expect(result.description).toContain("100 Armor");
    expect(result.description).toContain("80 Magic Resist");
  });

  it("appends stats for Wooglet's Witchcap from items database", () => {
    const augments = new Map<string, Augment>();
    augments.set(
      "quest: wooglet's witchcap",
      makeAugment(
        "Quest: Wooglet's Witchcap",
        "Gain a Needlessly Large Rod. Quest: Obtain Rabadon's Deathcap and Zhonya's Hourglass. Reward: Upon completing your Quest, convert the items into Wooglet's Witchcap."
      )
    );

    const items = buildItemsMap([woogletsWitchcap]);
    enrichQuestAugments(augments, items);

    const result = augments.get("quest: wooglet's witchcap")!;
    expect(result.description).toContain("300 Ability Power");
    expect(result.description).toContain("50 Armor");
  });

  it("does not modify quest augments when reward item is not in items database", () => {
    const augments = new Map<string, Augment>();
    const original =
      "Quest: Score 18 champion takedowns. Reward: Upon completing your Quest, you receive The Golden Spatula.";
    augments.set(
      "quest: urf's champion",
      makeAugment("Quest: Urf's Champion", original)
    );

    // Empty items database — reward item not found
    const items = buildItemsMap([]);
    enrichQuestAugments(augments, items);

    expect(augments.get("quest: urf's champion")!.description).toBe(original);
  });

  it("does not modify non-quest augments", () => {
    const augments = new Map<string, Augment>();
    const original = "Grants 60% bonus attack speed.";
    augments.set("deft", makeAugment("Deft", original));

    const items = buildItemsMap([goldenSpatula]);
    enrichQuestAugments(augments, items);

    expect(augments.get("deft")!.description).toBe(original);
  });

  it("only searches for reward items after 'Reward:' in description", () => {
    const augments = new Map<string, Augment>();
    // Bami's Cinder is mentioned before "Reward:" — should NOT get its stats appended
    const bamiCinder = makeItem("Bami's Cinder", { FlatHPPoolMod: 200 });
    augments.set(
      "quest: icathia's fall",
      makeAugment(
        "Quest: Icathia's Fall",
        "Gain Bami's Cinder. Quest: Obtain Hollow Radiance and Sunfire Aegis. Reward: Upon completing your Quest, convert the items into Void Immolation."
      )
    );

    const items = buildItemsMap([bamiCinder, voidImmolation]);
    enrichQuestAugments(augments, items);

    const result = augments.get("quest: icathia's fall")!;
    // Should have Void Immolation stats (after Reward:)
    expect(result.description).toContain("1000 Health");
    // Should NOT have Bami's Cinder stats (before Reward:)
    expect(result.description).not.toContain("200 Health");
  });

  it("formats percentage stats correctly", () => {
    const augments = new Map<string, Augment>();
    augments.set(
      "quest: urf's champion",
      makeAugment(
        "Quest: Urf's Champion",
        "Reward: you receive The Golden Spatula."
      )
    );

    const items = buildItemsMap([goldenSpatula]);
    enrichQuestAugments(augments, items);

    const result = augments.get("quest: urf's champion")!;
    // PercentAttackSpeedMod: 0.6 → "60% Attack Speed"
    expect(result.description).toContain("60% Attack Speed");
    // FlatCritChanceMod: 0.25 → "25% Critical Strike Chance"
    expect(result.description).toContain("25% Critical Strike Chance");
    // PercentMovementSpeedMod: 0.1 → "10% Move Speed"
    expect(result.description).toContain("10% Move Speed");
  });

  it("handles augments map with no quest augments", () => {
    const augments = new Map<string, Augment>();
    augments.set("deft", makeAugment("Deft", "Grants 60% bonus attack speed."));

    const items = buildItemsMap([goldenSpatula]);
    enrichQuestAugments(augments, items);

    expect(augments.get("deft")!.description).toBe(
      "Grants 60% bonus attack speed."
    );
  });
});
