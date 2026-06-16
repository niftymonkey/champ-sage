import { describe, it, expect } from "vitest";
import { buildAugmentPatchlineReport } from "./augment-patchline-report";
import type { RawCDragonAugment } from "./sources/community-dragon";
import type { Augment } from "./types";

function mayhemAug(
  id: number,
  name: string,
  rarity: string
): RawCDragonAugment {
  return {
    id,
    nameTRA: name,
    rarity,
    augmentSmallIconPath: `/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/${name.replace(
      /\s/g,
      ""
    )}_small.png`,
  };
}

function wikiAug(name: string, sets: string[] = []): [string, Augment] {
  return [
    name.toLowerCase(),
    { name, description: "desc", tier: "Silver", sets, mode: "mayhem" },
  ];
}

function makeInput() {
  return {
    base: [
      mayhemAug(1, "Adapt", "kSilver"),
      mayhemAug(2, "Blade Waltz", "kGold"),
    ],
    candidate: [
      mayhemAug(1, "Adapt", "kGold"), // rarity changed
      mayhemAug(3, "Spirit Bomb", "kPrismatic"), // new, has wiki
      mayhemAug(4, "Mystery Aug", "kSilver"), // new, no wiki -> dropped
      mayhemAug(5, "Firecracker", "kGold"), // new, name == known set -> repurposed (and no wiki)
    ],
    wikiAugments: new Map<string, Augment>([
      wikiAug("Adapt", ["High Roller"]),
      wikiAug("Blade Waltz"),
      wikiAug("Spirit Bomb"),
    ]),
    knownSetNames: ["Firecracker", "Snowday"],
  };
}

describe("buildAugmentPatchlineReport", () => {
  it("reports mode and roster counts", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.mode).toBe("mayhem");
    expect(r.baseCount).toBe(2);
    expect(r.candidateCount).toBe(4);
  });

  it("separates additions by id from additions by name", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.addedById.map((a) => a.id).sort()).toEqual([3, 4, 5]);
    expect(r.addedByName.map((a) => a.name).sort()).toEqual([
      "Firecracker",
      "Mystery Aug",
      "Spirit Bomb",
    ]);
  });

  it("reports removed augments", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.removed.map((a) => a.name)).toEqual(["Blade Waltz"]);
  });

  it("detects rarity changes for augments present in both rosters", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.rarityChanged).toEqual([
      { id: 1, name: "Adapt", from: "kSilver", to: "kGold" },
    ]);
  });

  it("flags candidate augments production would drop for missing descriptions", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.droppedForMissingDescription.map((a) => a.name).sort()).toEqual([
      "Firecracker",
      "Mystery Aug",
    ]);
    expect(r.wikiCoverage).toEqual({ described: 2, total: 4 });
  });

  it("surfaces grouping signals", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.grouping.wikiSetMembershipCount).toBe(1);
    expect(r.grouping.repurposedSetNames).toEqual(["Firecracker"]);
  });

  it("dedupes name-keyed lists when CDragon has duplicate names", () => {
    const input = makeInput();
    input.candidate.push(mayhemAug(6, "Mystery Aug", "kSilver")); // dup name, new id
    const r = buildAugmentPatchlineReport(input);
    expect(
      r.droppedForMissingDescription.filter((a) => a.name === "Mystery Aug")
    ).toHaveLength(1);
    expect(r.addedByName.filter((a) => a.name === "Mystery Aug")).toHaveLength(
      1
    );
  });

  it("isolates the PBE-introduced gap: new augments that lack a wiki description", () => {
    const r = buildAugmentPatchlineReport(makeInput());
    expect(r.addedMissingWiki.map((a) => a.name).sort()).toEqual([
      "Firecracker",
      "Mystery Aug",
    ]);
  });

  it("only considers augments of the requested mode", () => {
    const input = makeInput();
    input.candidate.push({
      id: 99,
      nameTRA: "Arena Thing",
      rarity: "kGold",
      augmentSmallIconPath:
        "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/ArenaThing_small.png",
    });
    const r = buildAugmentPatchlineReport(input);
    expect(r.candidateCount).toBe(4); // arena augment excluded
    expect(r.addedById.some((a) => a.id === 99)).toBe(false);
  });
});
