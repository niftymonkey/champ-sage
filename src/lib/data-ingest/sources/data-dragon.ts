import { getLogger } from "../../logger";
import type {
  AbilityPassive,
  AbilitySpell,
  Champion,
  ChampionAbilities,
  Item,
  ItemGold,
  ItemMode,
  Rune,
  RuneTree,
} from "../types";

const BASE_URL = "https://ddragon.leagueoflegends.com";

const log = getLogger("data-ingest");

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/versions.json`);
  if (!res.ok) throw new Error(`Failed to fetch versions: ${res.status}`);
  const versions: string[] = await res.json();
  return versions[0];
}

/**
 * Whether a DDragon champion id names a mode-specific variant rather than the
 * canonical champion.
 *
 * Patch 16.15.1 introduced the Classic Rift ("Jade") roster: sixty entries with
 * ids like `Jade_Ashe`, keys at `60000 + canonicalKey`, legacy base stats, and
 * legacy ability kits, but a `name` byte-identical to the canonical champion.
 * Riot has never used `_` in a canonical champion id (`MonkeyKing`, `Nunu`,
 * `AurelionSol` are all bare CamelCase), so the separator is the discriminator.
 *
 * Variants are excluded rather than merged: the rest of the pipeline assumes
 * one champion per name, and serving a Classic Rift game correctly needs more
 * than a name key (its own item shop and ability kits). Until that mode is
 * supported, the only correct answer for these entries is to leave them out.
 */
function isVariantChampionId(id: string): boolean {
  return id.includes("_");
}

export async function fetchChampions(
  version: string
): Promise<Map<string, Champion>> {
  const res = await fetch(
    `${BASE_URL}/cdn/${version}/data/en_US/champion.json`
  );
  if (!res.ok) throw new Error(`Failed to fetch champions: ${res.status}`);
  const json = await res.json();
  const champions = new Map<string, Champion>();

  let skippedVariants = 0;
  const collisions: string[] = [];

  for (const [, raw] of Object.entries<RawChampion>(json.data)) {
    if (isVariantChampionId(raw.id)) {
      skippedVariants++;
      continue;
    }

    const key = raw.name.toLowerCase();
    const existing = champions.get(key);
    if (existing) collisions.push(`${existing.id}/${raw.id}`);

    champions.set(key, {
      id: raw.id,
      key: Number(raw.key),
      name: raw.name,
      title: raw.title,
      tags: raw.tags,
      partype: raw.partype,
      stats: raw.stats,
      image: `${BASE_URL}/cdn/${version}/img/champion/${raw.image.full}`,
    });
  }

  if (skippedVariants > 0) {
    log.info(
      `Skipped ${skippedVariants} mode-variant champion entries (e.g. Jade_*); ${champions.size} canonical champions kept.`
    );
  }

  // A surviving collision means Riot started shipping duplicate-named entries
  // under a scheme `isVariantChampionId` does not recognize. Silence here is
  // what let the Jade roster overwrite sixty canonical champions unnoticed for
  // a full patch: the map still had exactly 173 entries, so every count-based
  // check passed while the contents were wrong.
  if (collisions.length > 0) {
    log.warn(
      `Champion name collisions after variant filtering (${collisions.length}): ${collisions.join(", ")}. ` +
        `An unrecognized variant scheme is overwriting canonical champions.`
    );
  }

  return champions;
}

export async function fetchItems(version: string): Promise<Map<number, Item>> {
  const res = await fetch(`${BASE_URL}/cdn/${version}/data/en_US/item.json`);
  if (!res.ok) throw new Error(`Failed to fetch items: ${res.status}`);
  const json = await res.json();
  const items = new Map<number, Item>();

  for (const [idStr, raw] of Object.entries<RawItem>(json.data)) {
    const id = Number(idStr);

    const name = cleanItemName(raw.name);

    // Skip items with empty names (junk/placeholder entries)
    if (!name) continue;

    // Skip non-purchasable zero-gold items (system/internal: turret buffs, quest trackers, etc.)
    if (raw.gold.total === 0 && !raw.gold.purchasable) continue;

    items.set(id, {
      id,
      name,
      description: stripHtml(raw.description),
      plaintext: raw.plaintext ?? "",
      gold: raw.gold,
      tags: raw.tags ?? [],
      stats: raw.stats ?? {},
      from: raw.from?.map(Number),
      into: raw.into?.map(Number),
      image: `${BASE_URL}/cdn/${version}/img/item/${raw.image.full}`,
      mode: classifyItemMode(id),
      maps: parseAvailableMaps(raw.maps),
    });
  }

  return items;
}

export async function fetchRunes(version: string): Promise<RuneTree[]> {
  const res = await fetch(
    `${BASE_URL}/cdn/${version}/data/en_US/runesReforged.json`
  );
  if (!res.ok) throw new Error(`Failed to fetch runes: ${res.status}`);
  const json: RawRuneTree[] = await res.json();

  return json.map((tree) => ({
    id: tree.id,
    key: tree.key,
    name: tree.name,
    icon: `${BASE_URL}/cdn/img/${tree.icon}`,
    keystones: tree.slots[0].runes.map(mapRune),
    slots: tree.slots.slice(1).map((slot) => slot.runes.map(mapRune)),
  }));
}

function mapRune(raw: RawRune): Rune {
  return {
    id: raw.id,
    key: raw.key,
    name: raw.name,
    icon: `${BASE_URL}/cdn/img/${raw.icon}`,
    shortDesc: stripHtml(raw.shortDesc),
    longDesc: stripHtml(raw.longDesc),
  };
}

/**
 * Fetch ability data for EVERY champion in a single request.
 *
 * DDragon's `championFull.json` carries the same passive/spell payload as the
 * per-champion endpoint for all champions at once (~2MB). One request at
 * ingest time removes the need to fetch abilities per match, which is what
 * makes it possible to persist abilities into the cache before anything reads
 * them.
 *
 * Returns a Map keyed by lowercase champion ID (e.g. "ahri", "aurelionsol").
 */
export async function fetchAllChampionAbilities(
  version: string
): Promise<Map<string, ChampionAbilities>> {
  const abilities = new Map<string, ChampionAbilities>();

  const res = await fetch(
    `${BASE_URL}/cdn/${version}/data/en_US/championFull.json`
  );
  if (!res.ok) {
    log.warn(
      `championFull fetch failed (HTTP ${res.status}); champion abilities will be absent from coaching prompts`
    );
    return abilities;
  }

  const json: unknown = await res.json();
  const data = isRecord(json) && isRecord(json.data) ? json.data : null;
  if (!data) {
    log.warn(
      "championFull payload has no usable `data` object; champion abilities will be absent from coaching prompts"
    );
    return abilities;
  }

  // Validate per champion so one malformed entry costs that champion's
  // abilities, not the whole roster. Validation is explicit rather than a cast:
  // a cast only describes what we HOPE arrived, and a partially malformed entry
  // (a cooldown array holding a string, a spell missing its name) would not
  // throw, it would quietly reach coaching prompts as garbage.
  const failed: string[] = [];
  for (const [championId, raw] of Object.entries(data)) {
    const parsed = parseChampionAbilities(raw);
    if (!parsed) {
      failed.push(championId);
      continue;
    }
    abilities.set(championId.toLowerCase(), parsed);
  }
  if (failed.length > 0) {
    log.warn(
      `Could not parse abilities for ${failed.length} champion(s): ${failed.join(", ")}`
    );
  }
  return abilities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An array of finite numbers, or null. Guards the per-rank value series. */
function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    numbers.push(entry);
  }
  return numbers;
}

/**
 * Validate and normalize DDragon's raw passive/spell payload into our shape.
 * Returns null for anything that does not carry every field we depend on, so
 * the caller can skip that champion and record it.
 */
function parseChampionAbilities(value: unknown): ChampionAbilities | null {
  if (!isRecord(value)) return null;

  const passive = parseAbilityPassive(value.passive);
  if (!passive) return null;

  // Every real champion has spells; an empty list means the entry is a stub.
  if (!Array.isArray(value.spells) || value.spells.length === 0) return null;

  const spells: AbilitySpell[] = [];
  for (const raw of value.spells) {
    const spell = parseAbilitySpell(raw);
    if (!spell) return null;
    spells.push(spell);
  }

  return { passive, spells };
}

function parseAbilityPassive(value: unknown): AbilityPassive | null {
  if (!isRecord(value)) return null;
  const { name, description } = value;
  if (typeof name !== "string" || typeof description !== "string") return null;
  return { name, description: stripHtml(description) };
}

function parseAbilitySpell(value: unknown): AbilitySpell | null {
  if (!isRecord(value)) return null;

  const { id, name, description, maxrank } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof description !== "string" ||
    typeof maxrank !== "number" ||
    !Number.isFinite(maxrank)
  ) {
    return null;
  }

  const cooldowns = toNumberArray(value.cooldown);
  const costs = toNumberArray(value.cost);
  const range = toNumberArray(value.range);
  if (!cooldowns || !costs || !range) return null;

  return {
    id,
    name,
    description: stripHtml(description),
    maxRank: maxrank,
    cooldowns,
    costs,
    range,
  };
}

/**
 * Classify an item's game mode based on its ID range.
 * - 1000-8999: standard (Summoner's Rift)
 * - 9000-9999: swarm
 * - 220000-229999: arena
 * - 320000-329999: aram
 * - everything else: other (mode-specific variants, internal items)
 */
/**
 * The DDragon map IDs an item is available on, from its `maps` record of
 * `{ mapId: boolean }`. Only the true entries are kept, as numbers. A missing
 * record yields an empty list (available nowhere), which is correct: every
 * real purchasable item carries a maps record, so absence marks an internal
 * or deprecated entry that no catalog should surface.
 */
function parseAvailableMaps(
  maps: Record<string, boolean> | undefined
): number[] {
  if (!maps) return [];
  return Object.entries(maps)
    .filter(([, available]) => available)
    .map(([mapId]) => Number(mapId));
}

function classifyItemMode(id: number): ItemMode {
  if (id >= 9000 && id < 10000) return "swarm";
  if (id >= 220000 && id < 230000) return "arena";
  if (id >= 320000 && id < 330000) return "aram";
  if (id >= 1000 && id < 9000) return "standard";
  return "other";
}

/**
 * Clean an item name: strip HTML tags and take only the primary name
 * (before any <br> subtitle content). Returns empty string for junk entries.
 */
function cleanItemName(raw: string): string {
  // Split on <br> before stripping tags — the part after <br> is subtitle junk
  const beforeBr = raw.split(/<br\s*\/?>/i)[0];
  return stripHtml(beforeBr);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

// Raw DDragon response types

interface RawChampion {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  partype: string;
  stats: Champion["stats"];
  image: { full: string };
}

interface RawItem {
  name: string;
  description: string;
  plaintext?: string;
  gold: ItemGold;
  tags?: string[];
  stats?: Record<string, number>;
  from?: string[];
  into?: string[];
  image: { full: string };
  maps?: Record<string, boolean>;
}

interface RawRuneTree {
  id: number;
  key: string;
  name: string;
  icon: string;
  slots: { runes: RawRune[] }[];
}

interface RawRune {
  id: number;
  key: string;
  name: string;
  icon: string;
  shortDesc: string;
  longDesc: string;
}
