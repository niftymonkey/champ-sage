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
    const rawSet = String(fields.set ?? "-");
    const description = stripWikiMarkup(String(fields.description ?? ""));

    augments.set(name.toLowerCase(), {
      name,
      description,
      tier,
      set: stripWikiMarkup(rawSet),
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
