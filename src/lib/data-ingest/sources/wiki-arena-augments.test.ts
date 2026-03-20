import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchArenaAugments } from "./wiki-arena-augments";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function textResponse(text: string) {
  return { ok: true, text: () => Promise.resolve(text) };
}

const SAMPLE_LUA = `return {
    ["Blade Waltz"] = {
        ["description"] = "Gain {{as|10% Attack Speed}}. Your attacks deal {{as|bonus physical damage}} equal to {{as|2% of your max health}}.",
        ["tier"] = "Silver",
    },
    ["Ethereal Weapon"] = {
        ["description"] = "Your abilities deal {{as|12% bonus magic damage}}.",
        ["tier"] = "Gold",
    },
    ["Eureka"] = {
        ["description"] = "Your next augment selection has {{tip|Prismatic}} choices.",
        ["tier"] = "Prismatic",
        ["notes"] = [=[Only offered in the first round.]=],
    },
}`;

describe("fetchArenaAugments", () => {
  it("parses arena augments from wiki Lua module", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    expect(augments.size).toBe(3);
  });

  it("sets mode to arena for all augments", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    for (const aug of augments.values()) {
      expect(aug.mode).toBe("arena");
    }
  });

  it("normalizes tier values", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    expect(augments.get("blade waltz")!.tier).toBe("Silver");
    expect(augments.get("ethereal weapon")!.tier).toBe("Gold");
    expect(augments.get("eureka")!.tier).toBe("Prismatic");
  });

  it("strips wiki markup from descriptions", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    const blade = augments.get("blade waltz")!;
    expect(blade.description).not.toContain("{{");
    expect(blade.description).toContain("10% Attack Speed");
  });

  it("sets empty sets array for arena augments (no sets)", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    for (const aug of augments.values()) {
      expect(aug.sets).toEqual([]);
    }
  });

  it("keys augments by lowercase name", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    expect(augments.has("blade waltz")).toBe(true);
    expect(augments.has("ethereal weapon")).toBe(true);
    expect(augments.has("eureka")).toBe(true);
  });

  it("preserves original case in augment name field", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const augments = await fetchArenaAugments();
    expect(augments.get("blade waltz")!.name).toBe("Blade Waltz");
    expect(augments.get("ethereal weapon")!.name).toBe("Ethereal Weapon");
  });

  it("filters out system/fallback augments", async () => {
    const luaWithSystem = `return {
    ["Blade Waltz"] = {
        ["description"] = "Gain {{as|10% Attack Speed}}.",
        ["tier"] = "Silver",
    },
    ["404 Augment Not Found"] = {
        ["description"] = "Error: This augment is granted when effects fail.",
        ["tier"] = "Silver",
    },
    ["Augment 405"] = {
        ["description"] = "Error: This augment is granted when effects fail.",
        ["tier"] = "Prismatic",
    },
    ["Null"] = {
        ["description"] = "No effect.",
        ["tier"] = "Prismatic",
    },
}`;
    mockFetch.mockResolvedValue(textResponse(luaWithSystem));

    const augments = await fetchArenaAugments();
    expect(augments.size).toBe(1);
    expect(augments.has("blade waltz")).toBe(true);
    expect(augments.has("404 augment not found")).toBe(false);
    expect(augments.has("augment 405")).toBe(false);
    expect(augments.has("null")).toBe(false);
  });

  it("throws on fetch failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(fetchArenaAugments()).rejects.toThrow("404");
  });
});
