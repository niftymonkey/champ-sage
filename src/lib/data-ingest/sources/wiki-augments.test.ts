import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWikiAugments } from "./wiki-augments";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockWiki(lua: string): void {
  mockFetch.mockResolvedValue({ ok: true, text: async () => lua });
}

/**
 * The wiki's MayhemAugmentData module still carries `set` tags on legacy
 * augments, but ARAM Mayhem removed Traits (sets) in the 26.12 rework. Those
 * tags are stale data for a mechanic the live game no longer has, so ingest
 * must not surface them: every Mayhem augment carries an empty `sets`.
 */
describe("fetchWikiAugments", () => {
  it("strips a wiki set tag while preserving name, description, tier, mode", async () => {
    mockWiki(`-- <pre>
return {
	["Set Tagged"] = {
		["tier"] = "Gold",
		["set"] = "[[File:Set.png]] [[ARAM: Mayhem/Augment Sets|Archmage]]",
		["description"] = "Casting an ability refunds cooldown.",
	},
}
-- </pre>`);

    const aug = (await fetchWikiAugments()).get("set tagged");

    expect(aug).toEqual({
      name: "Set Tagged",
      description: "Casting an ability refunds cooldown.",
      tier: "Gold",
      sets: [],
      mode: "mayhem",
    });
  });

  it("collapses multi-set legacy tags to empty", async () => {
    mockWiki(`-- <pre>
return {
	["Self Destruct"] = {
		["tier"] = "Gold",
		["set"] = "[[File:A.png]] [[ARAM: Mayhem/Augment Sets|Dive Bomb]]<br>[[File:B.png]] [[ARAM: Mayhem/Augment Sets|Fully Automated]]",
		["description"] = "Explode on death.",
	},
}
-- </pre>`);

    expect((await fetchWikiAugments()).get("self destruct")?.sets).toEqual([]);
  });
});
