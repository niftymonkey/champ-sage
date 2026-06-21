/**
 * SPIKE: Extract ARAM Mayhem (KIWI) augment descriptions from CommunityDragon RAW game data.
 *
 * Proves we can reproduce Mayhem augment description text directly from CDragon's raw
 * `.bin.json` + string-table endpoints, bypassing the human-edited wiki that lags each patch.
 *
 * This is a throwaway feasibility spike. It is intentionally read-only and self-contained:
 * it does not touch src/ or electron/. See docs/research/kiwi-augment-extraction-spike.md
 * for the full findings.
 *
 * Pipeline (mirrors CDTB's arenadata.py, pointed at the KIWI mode bin):
 *   1. cherry-augments.json     -> id -> augmentNameId (apiName) lookup
 *   2. modespecificdata/kiwi.bin -> AugmentData entry per apiName, carries the desc/tooltip
 *                                   string-table keys plus a RootSpell reference
 *   3. RootSpell -> SpellObject.mSpell.DataValues -> @token@ substitution values
 *   4. lol.stringtable.json      -> resolve the desc/tooltip keys to English text
 *
 * Usage:
 *   pnpm spike-kiwi                 # latest (live) branch
 *   pnpm spike-kiwi -- --pbe        # pbe branch (next-patch data)
 *   pnpm spike-kiwi -- 1205 1414    # specific augment ids (default: ADAPt + Droppybara + Hand of Baron)
 */

const LATEST = "https://raw.communitydragon.org/latest";
const PBE = "https://raw.communitydragon.org/pbe";

const CATALOG_PATH =
  "/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json";
const KIWI_BIN_PATH = "/game/maps/modespecificdata/kiwi.bin.json";
const STRINGTABLE_PATH = "/game/en_us/data/menu/en_us/lol.stringtable.json";

/** A single entry from cherry-augments.json (the unified id/name/icon/rarity catalog). */
interface CatalogAugment {
  id: number;
  augmentNameId: string;
  nameTRA: string;
  rarity: string;
}

/**
 * Raw `.bin.json` records are dynamically shaped: CDTB de-hashes well-known field names
 * but leaves unknown fields as `{hexhash}` keys, and value shapes vary by record type.
 * We treat the parsed bin as an untyped record map at the fetch boundary and narrow by
 * the `__type` discriminator as we read.
 */
type BinValue = unknown;
type BinFile = Record<string, BinValue>;

interface ResolvedAugment {
  id: number;
  apiName: string;
  name: string;
  rarity: string;
  descRaw: string;
  desc: string;
  tooltipRaw: string;
  tooltip: string;
  dataValues: Record<string, number>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Collect every `__type === wantType` record from a parsed bin file. */
function entriesOfType(
  bin: BinFile,
  wantType: string
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const value of Object.values(bin)) {
    if (isRecord(value) && value.__type === wantType) {
      out.push(value);
    }
  }
  return out;
}

/**
 * Resolve a string-table key to English text.
 *
 * CDragon de-hashes most RST keys back to their lowercased readable name, so we look up
 * the lowercased key. Keys it could not reverse remain as `{hexhash}` and will simply miss.
 */
function resolveString(
  stringtable: Record<string, string>,
  key: string
): string {
  if (!key) return "";
  return stringtable[key.toLowerCase()] ?? "";
}

/**
 * Substitute `@token@` placeholders against the augment's DataValues.
 *
 * Supported shapes (covering the live KIWI catalog):
 *   @Name@      -> dataValue Name
 *   @Name*N@    -> dataValue Name multiplied by constant N (e.g. @APAmp*100@ for a percent)
 *
 * Computed tokens (e.g. @f1@, @...CalcTooltip@) come from mSpellCalculations, which CDTB
 * itself passes through raw and does not resolve. We leave those placeholders intact, which
 * is exactly the fidelity the curated Arena file ships with.
 */
function substituteTokens(
  text: string,
  dataValues: Record<string, number>
): string {
  return text.replace(/@([^@]+)@/g, (whole, token: string) => {
    const multMatch = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\*([0-9.]+)$/);
    if (multMatch) {
      const [, name, factor] = multMatch;
      const base = dataValues[name];
      if (base === undefined) return whole;
      return formatNumber(base * Number(factor));
    }
    const base = dataValues[token];
    if (base === undefined) return whole;
    return formatNumber(base);
  });
}

function formatNumber(n: number): string {
  // Riot floats carry binary-rounding noise (0.30000001...); round to 4 dp then trim.
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

/** Pull DataValues for an augment by following its RootSpell to the SpellObject. */
function dataValuesForAugment(
  augment: Record<string, unknown>,
  bin: BinFile
): Record<string, number> {
  const rootSpell = asString(augment.RootSpell);
  if (!rootSpell) return {};

  const spellObject = bin[rootSpell];
  if (!isRecord(spellObject)) return {};

  const spell = spellObject.mSpell;
  if (!isRecord(spell)) return {};

  const rawValues = spell.DataValues ?? spell.mDataValues;
  if (!Array.isArray(rawValues)) return {};

  const out: Record<string, number> = {};
  for (const dv of rawValues) {
    if (!isRecord(dv)) continue;
    const name = asString(dv.name ?? dv.mName);
    const values = dv.values ?? dv.mValues;
    if (name && Array.isArray(values) && typeof values[0] === "number") {
      // Mayhem augments have no per-level scaling; all entries share index 0.
      out[name] = values[0];
    }
  }
  return out;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const usePbe = args.includes("--pbe");
  const base = usePbe ? PBE : LATEST;
  const requestedIds = args
    .filter((a) => /^\d+$/.test(a))
    .map((a) => Number(a));
  // Defaults: ARAM_ADAPt (shared, reuses Arena string), Droppybara + Hand of Baron (Mayhem-only).
  const ids = requestedIds.length > 0 ? requestedIds : [1205, 1414, 1389];

  console.log(`Branch: ${usePbe ? "PBE" : "latest (live)"}  (${base})`);
  console.log("Fetching catalog, kiwi bin, and string table...\n");

  const [catalog, kiwiBin, stringtableFile] = await Promise.all([
    fetchJson<CatalogAugment[]>(base + CATALOG_PATH),
    fetchJson<BinFile>(base + KIWI_BIN_PATH),
    fetchJson<{ entries: Record<string, string> }>(base + STRINGTABLE_PATH),
  ]);

  const stringtable = stringtableFile.entries;
  const catalogById = new Map(catalog.map((a) => [a.id, a]));

  const augmentEntries = entriesOfType(kiwiBin, "AugmentData");
  const augmentByApiName = new Map<string, Record<string, unknown>>();
  for (const entry of augmentEntries) {
    augmentByApiName.set(asString(entry.AugmentNameId), entry);
  }

  console.log(`Catalog augments: ${catalog.length}`);
  console.log(`KIWI AugmentData records: ${augmentEntries.length}\n`);

  for (const id of ids) {
    const catalogEntry = catalogById.get(id);
    if (!catalogEntry) {
      console.log(`id ${id}: not in catalog\n`);
      continue;
    }
    const augment = augmentByApiName.get(catalogEntry.augmentNameId);
    if (!augment) {
      console.log(
        `id ${id} (${catalogEntry.augmentNameId}): not in kiwi.bin\n`
      );
      continue;
    }

    const dataValues = dataValuesForAugment(augment, kiwiBin);
    const descRaw = resolveString(
      stringtable,
      asString(augment.DescriptionTra)
    );
    const tooltipRaw = resolveString(
      stringtable,
      asString(augment.AugmentTooltipTra)
    );
    const name = resolveString(stringtable, asString(augment.NameTra));

    const resolved: ResolvedAugment = {
      id,
      apiName: catalogEntry.augmentNameId,
      name,
      rarity: catalogEntry.rarity,
      descRaw,
      desc: substituteTokens(descRaw, dataValues),
      tooltipRaw,
      tooltip: substituteTokens(tooltipRaw, dataValues),
      dataValues,
    };

    printAugment(resolved);
  }
}

function stripMarkup(text: string): string {
  // Drop Riot's inline <color>/<scale>/<rules> tags for a readable plain-text comparison.
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function printAugment(a: ResolvedAugment): void {
  console.log("=".repeat(72));
  console.log(`${a.name}  (id ${a.id}, ${a.apiName}, ${a.rarity})`);
  console.log("-".repeat(72));
  console.log("desc (tokens substituted):");
  console.log("  " + stripMarkup(a.desc));
  console.log("tooltip (tokens substituted):");
  console.log("  " + stripMarkup(a.tooltip));
  const dvKeys = Object.keys(a.dataValues);
  if (dvKeys.length > 0) {
    console.log(
      "dataValues: " + dvKeys.map((k) => `${k}=${a.dataValues[k]}`).join(", ")
    );
  }
  console.log("");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
