import type { Augment } from "../types";
import { cdragonBranch, type Patchline } from "../patchline";
import {
  fetchCDragonAugments,
  normalizePath,
  rarityToTier,
  type RawCDragonAugment,
} from "./community-dragon";

/**
 * ARAM Mayhem (Riot codename KIWI) augment descriptions, extracted directly
 * from CommunityDragon raw game data instead of the hand-edited wiki.
 *
 * Three endpoints join into one augment map (mirrors CDTB's arenadata.py,
 * pointed at the KIWI mode bin rather than the Arena map bin):
 *   1. cherry-augments.json  -> id / apiName / icon / rarity catalog
 *   2. kiwi.bin.json         -> AugmentData record per apiName, carrying the
 *                               desc/name string-table keys + a RootSpell ref
 *   3. lol.stringtable.json  -> resolves those keys to English text
 *
 * The text is fresh on patch day (and ~2 days earlier on the `pbe` branch),
 * unlike the wiki which lags days to weeks. See
 * docs/research/kiwi-augment-extraction-spike.md for the proof and the
 * technical-reference "Augment descriptions" section for the source map.
 */

const CDRAGON_BASE = "https://raw.communitydragon.org";
const KIWI_BIN_PATH = "/game/maps/modespecificdata/kiwi.bin.json";
const STRINGTABLE_PATH = "/game/en_us/data/menu/en_us/lol.stringtable.json";

/**
 * Raw `.bin.json` records are dynamically shaped: CDragon de-hashes well-known
 * field names but leaves unknown fields as `{hexhash}` keys, and value shapes
 * vary by record type. We treat the parsed bin as an untyped record map and
 * narrow by the `__type` discriminator as we read.
 */
type BinFile = Record<string, unknown>;

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
    if (isRecord(value) && value.__type === wantType) out.push(value);
  }
  return out;
}

/**
 * Resolve a string-table key to English text. CDragon de-hashes most RST keys
 * back to their lowercased readable name, so we look up the lowercased key.
 * Keys it could not reverse remain `{hexhash}` and simply miss (return "").
 */
function resolveString(
  stringtable: Record<string, string>,
  key: string
): string {
  if (!key) return "";
  return stringtable[key.toLowerCase()] ?? "";
}

function formatNumber(n: number): string {
  // Riot floats carry binary-rounding noise (0.30000001...); round to 4 dp then trim.
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

/**
 * Substitute `@token@` placeholders against the augment's DataValues:
 *   @Name@   -> dataValue Name
 *   @Name*N@ -> dataValue Name multiplied by constant N (e.g. @APAmp*100@ %)
 *
 * Computed tokens (@f1@, @...CalcTooltip@, quest tokens) come from
 * mSpellCalculations, which CDTB itself passes through raw. We leave those
 * intact, matching the fidelity the curated Arena file ships with.
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

/**
 * Strip Riot's inline description markup to plain text for the coaching LLM,
 * the raw-data analogue of stripWikiMarkup:
 *   - `<br>` -> space, all other `<tag>`s removed keeping their inner text
 *   - runtime templates like `{{SpellName}}` removed (we cannot resolve the
 *     per-cast spell name; the augment name carries that context)
 *   - inline icon markers like `%i:scaleCrit%` removed
 *
 * ponytail: computed `@token@` placeholders (e.g. @f1@, @Calc_Resists@) are
 * left intact, matching the fidelity CDTB ships for Arena; resolving them needs
 * an mSpellCalculations evaluator and they cluster in the tooltip, not desc.
 */
function stripCdragonMarkup(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/%i:[^%]*%/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Join the cherry catalog, the KIWI mode bin, and the string table into
 * fully-formed Mayhem augments keyed by lowercased display name (the same key
 * convention fetchWikiAugments uses, so the orchestration merge consumes it
 * unchanged).
 *
 * Only catalog entries whose `augmentNameId` appears in the KIWI bin are
 * returned. The bin holds Mayhem augments exclusively, so the join filters to
 * KIWI for free: Arena's "ADAPt" (205) is dropped while Mayhem's "ARAM_ADAPt"
 * (1205) is kept. `description` is the short `desc`, not the tooltip.
 * `iconPath` is the RAW catalog asset path; fetchKiwiAugments normalizes it.
 */
export function resolveKiwiAugments(
  catalog: RawCDragonAugment[],
  kiwiBin: BinFile,
  stringtable: Record<string, string>
): Map<string, Augment> {
  const augmentByApiName = new Map<string, Record<string, unknown>>();
  for (const entry of entriesOfType(kiwiBin, "AugmentData")) {
    augmentByApiName.set(asString(entry.AugmentNameId), entry);
  }

  const out = new Map<string, Augment>();
  for (const cat of catalog) {
    const binEntry = augmentByApiName.get(cat.augmentNameId);
    if (!binEntry) continue; // not a KIWI augment

    const dataValues = dataValuesForAugment(binEntry, kiwiBin);
    const description = stripCdragonMarkup(
      substituteTokens(
        resolveString(stringtable, asString(binEntry.DescriptionTra)),
        dataValues
      )
    );
    // Prefer the bin's resolved name (matches the wiki); fall back to the
    // catalog name if the string table cannot resolve the key.
    const name =
      resolveString(stringtable, asString(binEntry.NameTra)) || cat.nameTRA;

    out.set(name.toLowerCase(), {
      name,
      description,
      tier: rarityToTier(cat.rarity),
      sets: [],
      mode: "mayhem",
      id: cat.id,
      iconPath: cat.augmentSmallIconPath,
    });
  }
  return out;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetch ARAM Mayhem (KIWI) augments from CommunityDragon raw game data for a
 * patchline, returning fully-formed Mayhem augments keyed by lowercased
 * display name with descriptions, tiers, ids, and normalized icon URLs.
 * Throws if any of the three endpoints responds !ok (the data-ingest source
 * convention); callers degrade to the wiki fallback on rejection.
 */
export async function fetchKiwiAugments(
  patchline: Patchline = "live"
): Promise<Map<string, Augment>> {
  const base = `${CDRAGON_BASE}/${cdragonBranch(patchline)}`;
  const [catalog, kiwiBin, stringtableFile] = await Promise.all([
    fetchCDragonAugments(patchline),
    fetchJson<BinFile>(base + KIWI_BIN_PATH),
    fetchJson<{ entries: Record<string, string> }>(base + STRINGTABLE_PATH),
  ]);

  const augments = resolveKiwiAugments(
    catalog,
    kiwiBin,
    stringtableFile.entries
  );
  for (const augment of augments.values()) {
    if (augment.iconPath) {
      augment.iconPath = normalizePath(augment.iconPath, patchline);
    }
  }
  return augments;
}
