import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mergeAugmentIds,
  classifyAugmentMode,
  MISSING_DESCRIPTION_PLACEHOLDER,
} from "./community-dragon";
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
          sets: [],
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
          sets: [],
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

  it("matches Quest-prefixed CDragon names to non-prefixed wiki names", async () => {
    const augments = new Map<string, Augment>([
      [
        "sneakerhead",
        {
          name: "Sneakerhead",
          description: "test",
          tier: "Gold",
          sets: [],
          mode: "mayhem",
        },
      ],
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 1001,
            nameTRA: "Quest: Sneakerhead",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/Sneakerhead_small.png",
            rarity: "kGold",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    expect(augments.get("sneakerhead")!.id).toBe(1001);
  });

  it("skips unmatched Arena-mode CDragon augments (arena wiki is authoritative; junk is arena-coded)", async () => {
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
          {
            id: 404,
            nameTRA: "404 Augment Not Found",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Augment404_small.png",
            rarity: "kSilver",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    expect(augments.size).toBe(0);
  });

  it("skips unmatched Swarm-mode CDragon augments (unsupported mode)", async () => {
    const augments = new Map<string, Augment>();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 700,
            nameTRA: "Battle Bunny Support",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Swarm/Augments/Icons/BattleBunny_small.png",
            rarity: "kSilver",
          },
        ]),
    });

    await mergeAugmentIds(augments);
    expect(augments.size).toBe(0);
  });

  it("keeps unmatched Mayhem CDragon augments with a placeholder description", async () => {
    const augments = new Map<string, Augment>();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 850,
            nameTRA: "Spirit Bomb",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/SpiritBomb_small.png",
            rarity: "kPrismatic",
          },
        ]),
    });

    await mergeAugmentIds(augments, "pbe");

    const aug = augments.get("spirit bomb");
    expect(aug).toBeDefined();
    expect(aug?.name).toBe("Spirit Bomb");
    expect(aug?.description).toBe(MISSING_DESCRIPTION_PLACEHOLDER);
    expect(aug?.tier).toBe("Prismatic");
    expect(aug?.mode).toBe("mayhem");
    expect(aug?.sets).toEqual([]);
    expect(aug?.id).toBe(850);
    expect(aug?.iconPath).toContain("/pbe/");
    expect(aug?.iconPath).toContain("spiritbomb_small.png");
  });

  it("maps CDragon rarity to tier for kept Mayhem augments", async () => {
    const augments = new Map<string, Augment>();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 1,
            nameTRA: "Silver One",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/A_small.png",
            rarity: "kSilver",
          },
          {
            id: 2,
            nameTRA: "Gold One",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/B_small.png",
            rarity: "kGold",
          },
          {
            id: 3,
            nameTRA: "Prismatic One",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/C_small.png",
            rarity: "kPrismatic",
          },
        ]),
    });

    await mergeAugmentIds(augments);

    expect(augments.get("silver one")?.tier).toBe("Silver");
    expect(augments.get("gold one")?.tier).toBe("Gold");
    expect(augments.get("prismatic one")?.tier).toBe("Prismatic");
  });

  it("falls back to Silver tier for an unrecognized Mayhem rarity", async () => {
    const augments = new Map<string, Augment>();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 9,
            nameTRA: "Mystery Rarity",
            augmentSmallIconPath:
              "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/M_small.png",
            rarity: "kBronze",
          },
        ]),
    });

    await mergeAugmentIds(augments);

    expect(augments.get("mystery rarity")?.tier).toBe("Silver");
  });

  it("prefers Mayhem-mode CDragon entries over Arena duplicates for wiki augments", async () => {
    const augments = new Map<string, Augment>([
      [
        "adapt",
        {
          name: "ADAPt",
          description: "test",
          tier: "Silver",
          sets: [],
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
