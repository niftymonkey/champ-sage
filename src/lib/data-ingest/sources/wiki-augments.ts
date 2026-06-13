import type { Augment } from "../types";
import { parseLuaTable } from "../parsers/lua-parser";
import { stripWikiMarkup } from "../parsers/wiki-markup";

const WIKI_URL =
  "https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw";

export async function fetchWikiAugments(): Promise<Map<string, Augment>> {
  const res = await fetch(WIKI_URL);
  if (!res.ok) throw new Error(`Failed to fetch wiki augments: ${res.status}`);
  const lua = await res.text();
  const parsed = parseLuaTable(lua);
  const augments = new Map<string, Augment>();

  for (const [name, fields] of Object.entries(parsed)) {
    const tier = normalizeTier(String(fields.tier ?? "Silver"));
    const description = stripWikiMarkup(String(fields.description ?? ""));

    // The 26.12 Mayhem rework removed Traits (sets). The wiki module still
    // carries stale `set` tags on legacy augments, but the live game has no
    // set bonuses, so we deliberately do not read that field: surfacing it
    // would feed the coaching LLM synergies that no longer exist. See
    // getMayhemAugmentSets() for the matching empty set-bonus source.
    augments.set(name.toLowerCase(), {
      name,
      description,
      tier,
      sets: [],
      mode: "mayhem",
    });
  }

  return augments;
}

function normalizeTier(tier: string): Augment["tier"] {
  const lower = tier.toLowerCase();
  if (lower === "gold") return "Gold";
  if (lower === "prismatic") return "Prismatic";
  return "Silver";
}
