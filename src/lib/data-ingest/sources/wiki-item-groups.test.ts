import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchItemMutexGroups } from "./wiki-item-groups";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// Mirrors the real Module:ItemData/data shape: leading wiki comments, a
// `-- <pre>` marker, scalar itemlimit fields (some with the stray trailing
// whitespace the live module carries), nested tables that must be skipped,
// and an itemlimit2 dual-membership entry (Terminus).
const SAMPLE_LUA = `-- If you are looking for removed items, go to Module:ItemData/data/removed
-- <pre>
return {
    ["Lord Dominik's Regards"] = {
        ["id"]                  = 3036,
        ["tier"]                = 3,
        ["type"]                = {"Legendary"},
        ["itemlimit"]           = "Fatality",
        ["modes"] = {
            ["aram"]            = true,
        },
        ["buy"]                 = 3300,
    },
    ["Mortal Reminder"] = {
        ["id"]                  = 3033,
        ["tier"]                = 3,
        ["itemlimit"]           = "Fatality",
        ["buy"]                 = 3200,
    },
    ["Terminus"] = {
        ["id"]                  = 3302,
        ["tier"]                = 3,
        ["itemlimit"]           = "Fatality",
        ["itemlimit2"]          = "Blight",
        ["buy"]                 = 3000,
    },
    ["Essence Reaver"] = {
        ["id"]                  = 3508,
        ["tier"]                = 3,
        ["itemlimit"]           = "Spellblade        ",
        ["buy"]                 = 2900,
    },
    ["Lost Chapter"] = {
        ["id"]                  = 3802,
        ["tier"]                = 2,
        ["buy"]                 = 1200,
    },
}`;

function textResponse(text: string) {
  return { ok: true, status: 200, text: () => Promise.resolve(text) };
}

describe("fetchItemMutexGroups", () => {
  it("collects itemlimit groups keyed by lowercase item name", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const groups = await fetchItemMutexGroups();
    expect(groups.get("lord dominik's regards")).toEqual(["Fatality"]);
    expect(groups.get("mortal reminder")).toEqual(["Fatality"]);
  });

  it("collects secondary itemlimit2 membership (Terminus is in two groups)", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const groups = await fetchItemMutexGroups();
    expect(groups.get("terminus")).toEqual(["Fatality", "Blight"]);
  });

  it("trims the stray trailing whitespace the live module carries", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const groups = await fetchItemMutexGroups();
    expect(groups.get("essence reaver")).toEqual(["Spellblade"]);
  });

  it("omits items that have no itemlimit field", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const groups = await fetchItemMutexGroups();
    expect(groups.size).toBe(4);
    expect(groups.has("lost chapter")).toBe(false);
  });

  it("throws when the wiki responds non-OK", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve(""),
    });

    await expect(fetchItemMutexGroups()).rejects.toThrow(/503/);
  });
});
