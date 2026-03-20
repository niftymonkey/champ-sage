import * as luaparse from "luaparse";
import type { AramOverrides } from "../types";

const CHAMPION_DATA_URL =
  "https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data?action=raw";

/**
 * Fetch ARAM balance overrides from the League Wiki ChampionData Lua module.
 * Each champion's stats block may contain an ["aram"] table with multipliers
 * for damage dealt/taken, healing, shielding, tenacity, etc.
 *
 * Returns a map keyed by lowercase champion name.
 */
export async function fetchAramOverrides(): Promise<
  Map<string, AramOverrides>
> {
  const res = await fetch(CHAMPION_DATA_URL);
  if (!res.ok) throw new Error(`Failed to fetch ChampionData: ${res.status}`);

  let lua = await res.text();
  lua = lua.replace(/^--\s*<pre>\s*\n?/, "").replace(/\n?--\s*<\/pre>\s*$/, "");
  // Replace unicode quotes/dashes that luaparse can't handle
  lua = lua
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");

  const ast = luaparse.parse(lua, { encodingMode: "x-user-defined" });
  const overrides = new Map<string, AramOverrides>();

  const returnStmt = ast.body[0];
  if (!returnStmt || returnStmt.type !== "ReturnStatement") return overrides;

  const table = returnStmt.arguments[0];
  if (!table || table.type !== "TableConstructorExpression") return overrides;

  for (const field of table.fields) {
    if (field.type !== "TableKey") continue;

    const champName = extractString(field.key);
    if (!champName) continue;

    const champTable = field.value;
    if (champTable.type !== "TableConstructorExpression") continue;

    const aram = extractAramBlock(champTable);
    if (aram) {
      overrides.set(champName.toLowerCase(), aram);
    }
  }

  return overrides;
}

function extractAramBlock(
  champTable: luaparse.TableConstructorExpression
): AramOverrides | null {
  for (const field of champTable.fields) {
    if (field.type !== "TableKey") continue;
    if (extractString(field.key) !== "stats") continue;

    const statsTable = field.value;
    if (statsTable.type !== "TableConstructorExpression") continue;

    for (const sf of statsTable.fields) {
      if (sf.type !== "TableKey") continue;
      if (extractString(sf.key) !== "aram") continue;

      const aramTable = sf.value;
      if (aramTable.type !== "TableConstructorExpression") continue;

      return parseAramFields(aramTable);
    }
  }
  return null;
}

function parseAramFields(
  table: luaparse.TableConstructorExpression
): AramOverrides {
  const raw: Record<string, number> = {};
  for (const field of table.fields) {
    if (field.type !== "TableKey") continue;
    const key = extractString(field.key);
    if (!key) continue;
    if (field.value.type === "NumericLiteral") {
      raw[key] = field.value.value;
    }
  }

  const result: AramOverrides = {
    dmgDealt: raw.dmg_dealt ?? 1,
    dmgTaken: raw.dmg_taken ?? 1,
  };
  if (raw.healing !== undefined) result.healing = raw.healing;
  if (raw.shielding !== undefined) result.shielding = raw.shielding;
  if (raw.tenacity !== undefined) result.tenacity = raw.tenacity;
  if (raw.energyregen_mod !== undefined)
    result.energyRegenMod = raw.energyregen_mod;
  if (raw.total_as !== undefined) result.totalAs = raw.total_as;
  if (raw.ability_haste !== undefined) result.abilityHaste = raw.ability_haste;

  return result;
}

function extractString(node: luaparse.Node): string | null {
  if (node.type === "StringLiteral") {
    return node.raw.slice(1, -1);
  }
  return null;
}
