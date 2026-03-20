import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeAugmentIds, classifyAugmentMode } from "./community-dragon";
import type { Augment } from "../types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("classifyAugmentMode", () => {
  it("classifies UX/Kiwi/ paths as mayhem", () => {
    expect(
      classifyAugmentMode(
        "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/ADAPt_small.png"
      )
    ).toBe("mayhem");
  });

  it("classifies Cherry/...Kiwi/ paths as mayhem", () => {
    expect(
      classifyAugmentMode(
        "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Kiwi/ADAPt_small.png"
      )
    ).toBe("mayhem");
  });

  it("classifies Cherry paths without Kiwi as arena", () => {
    expect(
      classifyAugmentMode(
        "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/AllForYou_small.png"
      )
    ).toBe("arena");
  });

  it("classifies Strawberry paths as swarm", () => {
    expect(
      classifyAugmentMode(
        "/lol-game-data/assets/ASSETS/UX/Strawberry/UpgradeSelection/Icons/ArmorUp_Large.png"
      )
    ).toBe("swarm");
  });

  it("classifies Swarm paths as swarm", () => {
    expect(
      classifyAugmentMode(
        "/lol-game-data/assets/ASSETS/UX/Swarm/Augments/Icons/BattleBunny_small.png"
      )
    ).toBe("swarm");
  });

  it("classifies unknown paths as unknown", () => {
    expect(classifyAugmentMode("/some/other/path.png")).toBe("unknown");
  });
});

describe("mergeAugmentIds", () => {
  it("merges CDragon IDs into matching wiki augments without overwriting mode", async () => {
    const augments = new Map<string, Augment>([
      [
        "adapt",
        {
          name: "ADAPt",
          description: "test",
          tier: "Silver",
          set: "-",
          mode: "mayhem",
        },
      ],
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 205,
            nameTRA: "ADAPt",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/ADAPt_small.png",
            rarity: "kSilver",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    expect(augments.get("adapt")!.id).toBe(205);
    expect(augments.get("adapt")!.mode).toBe("mayhem"); // mode NOT overwritten
  });

  it("handles punctuation differences in name matching", async () => {
    const augments = new Map<string, Augment>([
      [
        "get excited",
        {
          name: "Get Excited",
          description: "test",
          tier: "Gold",
          set: "-",
          mode: "mayhem",
        },
      ],
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 999,
            nameTRA: "Get Excited!",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/GetExcited_small.png",
            rarity: "kGold",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    expect(augments.get("get excited")!.id).toBe(999);
  });

  it("adds unmatched CDragon augments with their classified mode", async () => {
    const augments = new Map<string, Augment>();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 309,
            nameTRA: "And My Axe!",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/AndMyAxe_small.png",
            rarity: "kGold",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    const aug = augments.get("and my axe!");
    expect(aug).toBeDefined();
    expect(aug!.mode).toBe("arena");
    expect(aug!.id).toBe(309);
    expect(aug!.description).toBe("");
  });

  it("adds Strawberry augments classified as swarm", async () => {
    const augments = new Map<string, Augment>();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 500,
            nameTRA: "Armor Up",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Strawberry/UpgradeSelection/Icons/ArmorUp_Large.png",
            rarity: "kGold",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    const aug = augments.get("armor up");
    expect(aug).toBeDefined();
    expect(aug!.mode).toBe("swarm");
  });

  it("prefers Mayhem-mode CDragon entries over Arena duplicates for wiki augments", async () => {
    const augments = new Map<string, Augment>([
      [
        "adapt",
        {
          name: "ADAPt",
          description: "test",
          tier: "Silver",
          set: "-",
          mode: "mayhem",
        },
      ],
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 205,
            nameTRA: "ADAPt",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/ADAPt_small.png",
            rarity: "kSilver",
          },
          {
            id: 1205,
            nameTRA: "ADAPt",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/ADAPt_small.png",
            rarity: "kSilver",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    expect(augments.get("adapt")!.id).toBe(1205);
    expect(augments.get("adapt")!.mode).toBe("mayhem"); // still mayhem
  });
});
