import type {
  Champion,
  ChampionAbilities,
  Item,
  ItemGold,
  ItemMode,
  Rune,
  RuneTree,
} from "../types";

const BASE_URL = "https://ddragon.leagueoflegends.com";

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/versions.json`);
  if (!res.ok) throw new Error(`Failed to fetch versions: ${res.status}`);
  const versions: string[] = await res.json();
  return versions[0];
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

  for (const [, raw] of Object.entries<RawChampion>(json.data)) {
    champions.set(raw.name.toLowerCase(), {
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
 * Fetch full ability data for a list of champions by their DDragon IDs.
 * Each champion requires an individual API call — callers should batch
 * strategically (e.g., only the 10 in a live game, or one at a time during idle).
 *
 * Returns a Map keyed by lowercase champion ID (e.g., "ahri", "aurelionsol").
 */
export async function fetchChampionAbilities(
  version: string,
  championIds: string[]
): Promise<Map<string, ChampionAbilities>> {
  const results = await Promise.allSettled(
    championIds.map((id) => fetchSingleChampionAbilities(version, id))
  );

  const abilities = new Map<string, ChampionAbilities>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      abilities.set(result.value.key, result.value.abilities);
    }
  }
  return abilities;
}

async function fetchSingleChampionAbilities(
  version: string,
  championId: string
): Promise<{ key: string; abilities: ChampionAbilities } | null> {
  const res = await fetch(
    `${BASE_URL}/cdn/${version}/data/en_US/champion/${championId}.json`
  );
  if (!res.ok) return null;

  const json = (await res.json()) as {
    data?: Record<string, RawChampionFull>;
  };
  const data = json.data?.[championId];
  if (!data) return null;

  return {
    key: championId.toLowerCase(),
    abilities: {
      passive: {
        name: data.passive.name,
        description: stripHtml(data.passive.description),
      },
      spells: data.spells.map((spell) => ({
        id: spell.id,
        name: spell.name,
        description: stripHtml(spell.description),
        maxRank: spell.maxrank,
        cooldowns: spell.cooldown,
        costs: spell.cost,
        range: spell.range,
      })),
    },
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
}

interface RawChampionFull {
  passive: {
    name: string;
    description: string;
    image: { full: string };
  };
  spells: {
    id: string;
    name: string;
    description: string;
    maxrank: number;
    cooldown: number[];
    cost: number[];
    costType: string;
    range: number[];
  }[];
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
