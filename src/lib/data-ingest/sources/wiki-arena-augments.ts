import type { Augment } from "../types";
import { parseLuaTable } from "../parsers/lua-parser";
import { stripWikiMarkup } from "../parsers/wiki-markup";

const WIKI_URL =
  "https://wiki.leagueoflegends.com/en-us/Module:ArenaAugmentData/data?action=raw";

// System/fallback augments that the game grants when effects fail.
// These are never offered as player choices and should not appear in recommendations.
const SYSTEM_AUGMENTS = new Set([
  "404 augment not found",
  "augment 405",
  "null",
]);

export async function fetchArenaAugments(): Promise<Map<string, Augment>> {
  const res = await fetch(WIKI_URL);
  if (!res.ok) throw new Error(`Failed to fetch arena augments: ${res.status}`);
  const lua = await res.text();
  const parsed = parseLuaTable(lua);
  const augments = new Map<string, Augment>();

  for (const [name, fields] of Object.entries(parsed)) {
    if (SYSTEM_AUGMENTS.has(name.toLowerCase())) continue;

    const tier = normalizeTier(String(fields.tier ?? "Silver"));
    const description = stripWikiMarkup(String(fields.description ?? ""));

    augments.set(name.toLowerCase(), {
      name,
      description,
      tier,
      sets: [],
      mode: "arena",
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
