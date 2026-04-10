/**
 * Fetch meta build data from the Riot Match-v5 API.
 *
 * Collects high-elo match data, extracts item builds and rune pages per champion,
 * and outputs JSON files for use in coaching prompts.
 *
 * Fully resumable: persists progress incrementally, picks up where it left off.
 *
 * Usage:
 *   pnpm fetch-meta           # full collection run
 *   pnpm fetch-meta -- --test  # small test run (~1 min) to verify API connectivity
 *
 * Requires RIOT_API_KEY in .env (get one at https://developer.riotgames.com).
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

config({ path: resolve(PROJECT_ROOT, ".env") });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.RIOT_API_KEY;
if (!API_KEY) {
  console.error("RIOT_API_KEY not found in .env");
  process.exit(1);
}

/** Regional endpoint for League-v4 (player discovery) */
const REGIONAL_HOST = "https://na1.api.riotgames.com";

/** Continental endpoint for Match-v5 */
const CONTINENTAL_HOST = "https://americas.api.riotgames.com";

const CACHE_DIR = resolve(PROJECT_ROOT, "data/meta-builds/.cache");
const OUTPUT_DIR = resolve(PROJECT_ROOT, "src/data/meta-builds");

/**
 * Queue IDs we collect data for.
 *
 * NOTE: ARAM: Mayhem (queue 2400) is NOT collected. Riot explicitly does not
 * expose Mayhem match data through the public Match-v5 API — requests return
 * 403 Forbidden, and Mayhem games played recently appear to be reclassified as
 * queue 450 ("ARAM") in the API with augment data stripped. This was confirmed
 * by Riot in developer-relations issue #1109. ARAM meta builds transfer well
 * to Mayhem as a baseline for coaching, so the ARAM file is used for both.
 */
const QUEUES = {
  "ranked-solo": { id: 420, name: "Ranked Solo/Duo" },
  aram: { id: 450, name: "ARAM" },
  arena: { id: 1700, name: "Arena" },
} as const;

type QueueKey = keyof typeof QUEUES;

const TEST_MODE = process.argv.includes("--test");

/** How many match IDs to request per player (max 100) */
const MATCHES_PER_PLAYER = TEST_MODE ? 20 : 100;

/** Target unique matches per queue type before stopping collection */
const TARGET_MATCHES = TEST_MODE ? 50 : 50_000;

/**
 * Dev key rate limits:
 *   - 20 requests per 1 second
 *   - 100 requests per 2 minutes (120 seconds)
 *
 * The 2-minute window is the binding constraint: 100 requests / 120 seconds
 * = 0.83 req/sec sustained. We use a steady delay between every request
 * to stay safely under both limits — predictable, no cascading throttle messages.
 *
 * 2000ms = 60 requests per 2 minutes (40% headroom under the 100 limit). The
 * extra padding accounts for any ghost requests Riot may still be counting from
 * earlier runs and gives breathing room for any unexpected hiccups.
 */
const REQUEST_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Rate limiter — steady delay
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimitedFetch(url: string, retries = 5): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed);
  }
  lastRequestTime = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Riot-Token": API_KEY! },
      // 30s request timeout — fail fast on hung requests so we can retry
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Network errors, timeouts, connection resets — retry with backoff
    if (retries > 0) {
      const backoffSec = (6 - retries) * 5; // 5s, 10s, 15s, 20s, 25s
      console.warn(
        `  Network error: ${(err as Error).message}. Retrying in ${backoffSec}s... (${retries} retries left)`
      );
      await sleep(backoffSec * 1000);
      return rateLimitedFetch(url, retries - 1);
    }
    throw err;
  }

  // Safety net: if we somehow still get rate limited, respect the Retry-After header
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "10");
    console.warn(`  Rate limited (unexpected). Waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return rateLimitedFetch(url, retries);
  }

  // Transient server errors — retry with backoff
  if (res.status >= 500 && res.status < 600 && retries > 0) {
    const backoffSec = (6 - retries) * 5;
    console.warn(
      `  Server error ${res.status}. Retrying in ${backoffSec}s... (${retries} retries left)`
    );
    await sleep(backoffSec * 1000);
    return rateLimitedFetch(url, retries - 1);
  }

  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Types (used across collection and aggregation)
// ---------------------------------------------------------------------------

/** The subset of match data we persist per participant */
interface ParticipantData {
  puuid: string;
  championId: number;
  championName: string;
  win: boolean;
  items: number[]; // item0-item6
  perks: {
    statPerks: { defense: number; flex: number; offense: number };
    styles: Array<{
      description: string;
      style: number;
      selections: Array<{ perk: number }>;
    }>;
  };
  teamPosition: string;
  augments: number[]; // playerAugment1-4
}

interface MatchData {
  matchId: string;
  queueId: number;
  gameVersion: string;
  gameDuration: number;
  participants: ParticipantData[];
}

function extractMatchData(
  matchId: string,
  raw: Record<string, unknown>
): MatchData | null {
  const info = raw.info as Record<string, unknown> | undefined;
  if (!info) return null;

  const participants =
    (info.participants as Array<Record<string, unknown>>) ?? [];

  return {
    matchId,
    queueId: info.queueId as number,
    gameVersion: info.gameVersion as string,
    gameDuration: info.gameDuration as number,
    participants: participants.map((p) => ({
      puuid: p.puuid as string,
      championId: p.championId as number,
      championName: p.championName as string,
      win: p.win as boolean,
      items: [
        p.item0 as number,
        p.item1 as number,
        p.item2 as number,
        p.item3 as number,
        p.item4 as number,
        p.item5 as number,
        p.item6 as number,
      ],
      perks: p.perks as ParticipantData["perks"],
      teamPosition: (p.teamPosition as string) ?? "",
      augments: [
        p.playerAugment1 as number,
        p.playerAugment2 as number,
        p.playerAugment3 as number,
        p.playerAugment4 as number,
      ].filter((a) => a != null && a > 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadJsonCache<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJsonCache(path: string, data: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Resolve a Riot ID (gameName#tagLine) to a PUUID via Account-v1.
// Used to seed the snowball from a known casual-mode player (e.g. you).
// ---------------------------------------------------------------------------

async function resolvePuuidFromRiotId(riotId: string): Promise<string | null> {
  const [gameName, tagLine] = riotId.split("#");
  if (!gameName || !tagLine) {
    console.warn(
      `  Invalid RIOT_SEED_ID format: "${riotId}" (expected gameName#tagLine)`
    );
    return null;
  }
  const url =
    `${CONTINENTAL_HOST}/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    console.warn(`  Failed to resolve Riot ID "${riotId}": ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.puuid as string;
}

// ---------------------------------------------------------------------------
// Step 1: Discover high-elo PUUIDs (for ranked)
// ---------------------------------------------------------------------------

async function discoverHighEloPuuids(): Promise<string[]> {
  const cachePath = resolve(CACHE_DIR, "puuids-high-elo.json");
  const cached = loadJsonCache<string[]>(cachePath, []);
  if (cached.length > 0) {
    console.log(`  Using ${cached.length} cached high-elo PUUIDs`);
    return cached;
  }

  console.log("  Fetching Challenger/Grandmaster/Master players...");
  const puuids: Set<string> = new Set();

  // Challenger, Grandmaster, Master — dedicated endpoints, return all players
  for (const tier of [
    "challengerleagues",
    "grandmasterleagues",
    "masterleagues",
  ]) {
    const url = `${REGIONAL_HOST}/lol/league/v4/${tier}/by-queue/RANKED_SOLO_5x5`;
    const res = await rateLimitedFetch(url);
    if (!res.ok) {
      console.error(`  Failed to fetch ${tier}: ${res.status}`);
      continue;
    }
    const data = await res.json();
    for (const entry of data.entries ?? []) {
      if (entry.puuid) puuids.add(entry.puuid);
    }
    console.log(`  ${tier}: ${data.entries?.length ?? 0} players`);
  }

  // Diamond I — paginated endpoint, get a few pages for more coverage
  console.log("  Fetching Diamond I players...");
  for (let page = 1; page <= 5; page++) {
    const url = `${REGIONAL_HOST}/lol/league/v4/entries/RANKED_SOLO_5x5/DIAMOND/I?page=${page}`;
    const res = await rateLimitedFetch(url);
    if (!res.ok) break;
    const entries = await res.json();
    if (!Array.isArray(entries) || entries.length === 0) break;
    for (const entry of entries) {
      if (entry.puuid) puuids.add(entry.puuid);
    }
    console.log(`  Diamond I page ${page}: ${entries.length} players`);
  }

  const result = [...puuids];
  saveJsonCache(cachePath, result);
  console.log(`  Total high-elo PUUIDs discovered: ${result.length}`);
  return result;
}

// ---------------------------------------------------------------------------
// Step 2: Collect match IDs for a queue type
// ---------------------------------------------------------------------------

async function collectMatchIds(
  puuids: string[],
  queueKey: QueueKey
): Promise<string[]> {
  const queueId = QUEUES[queueKey].id;
  const cachePath = resolve(CACHE_DIR, `match-ids-${queueKey}.json`);
  const matchIds = new Set<string>(loadJsonCache<string[]>(cachePath, []));

  if (matchIds.size >= TARGET_MATCHES) {
    console.log(`  Already have ${matchIds.size} match IDs for ${queueKey}`);
    return [...matchIds];
  }

  console.log(
    `  Collecting match IDs for ${queueKey} (have ${matchIds.size}, target ${TARGET_MATCHES})...`
  );

  // Track which PUUIDs we've already queried for this queue
  const queriedPath = resolve(CACHE_DIR, `queried-puuids-${queueKey}.json`);
  const queriedPuuids = new Set<string>(
    loadJsonCache<string[]>(queriedPath, [])
  );

  let saveCounter = 0;

  for (const puuid of puuids) {
    if (matchIds.size >= TARGET_MATCHES) break;
    if (queriedPuuids.has(puuid)) continue;

    const url =
      `${CONTINENTAL_HOST}/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?queue=${queueId}&count=${MATCHES_PER_PLAYER}`;

    const res = await rateLimitedFetch(url);
    queriedPuuids.add(puuid);

    if (!res.ok) {
      if (res.status === 404) continue; // Player has no matches for this queue
      console.warn(`  Match list fetch failed for PUUID: ${res.status}`);
      continue;
    }

    const ids: string[] = await res.json();
    for (const id of ids) matchIds.add(id);

    // Persist incrementally every 50 players
    saveCounter++;
    if (saveCounter % 50 === 0) {
      saveJsonCache(cachePath, [...matchIds]);
      saveJsonCache(queriedPath, [...queriedPuuids]);
      process.stdout.write(
        `\r  ${matchIds.size} match IDs from ${queriedPuuids.size} players...`
      );
    }
  }

  // Final save
  saveJsonCache(cachePath, [...matchIds]);
  saveJsonCache(queriedPath, [...queriedPuuids]);
  console.log(`\n  Total match IDs for ${queueKey}: ${matchIds.size}`);
  return [...matchIds];
}

// ---------------------------------------------------------------------------
// Step 2b: Snowball discovery for non-ranked queues
// ---------------------------------------------------------------------------

/**
 * Interleaved snowball for non-ranked queues (ARAM, Mayhem, Arena).
 *
 * Unlike ranked-solo (where we have a known high-elo player list), casual
 * modes require discovering players dynamically. This function interleaves
 * match ID collection with match detail fetching in a single pass:
 *
 *   1. Take a PUUID from the front of the queue
 *   2. Fetch their recent match IDs for this queue
 *   3. For each NEW match ID, fetch match details immediately
 *   4. Extract all 10 participants from each match, add them to the queue
 *   5. Repeat — the queue grows as we discover new players
 *
 * This means seed PUUIDs (e.g. your own) have an immediate, compounding
 * impact: each match they played reveals 9 more players who actually play
 * this mode. Without this interleaving, discovery only kicks in after the
 * script has processed every seed PUUID, which for ranked-player seeds can
 * mean hours of dry queries for casual modes.
 *
 * Seed PUUIDs are ordered: priority seeds (e.g. user-provided Riot ID) go
 * first, then previously-discovered PUUIDs from the cache, then ranked
 * players as a fallback.
 */
async function collectMatchesSnowball(
  prioritySeeds: string[],
  fallbackSeeds: string[],
  queueKey: QueueKey
): Promise<MatchData[]> {
  const queueId = QUEUES[queueKey].id;

  const matchIdsPath = resolve(CACHE_DIR, `match-ids-${queueKey}.json`);
  const matchIds = new Set<string>(loadJsonCache<string[]>(matchIdsPath, []));

  const matchesDir = resolve(CACHE_DIR, `matches-${queueKey}`);
  ensureDir(matchesDir);
  const matchesDataPath = resolve(matchesDir, "_data.json");
  const matchesIndexPath = resolve(matchesDir, "_index.json");
  const matches: MatchData[] = loadJsonCache<MatchData[]>(matchesDataPath, []);
  const fetchedMatchIds = new Set<string>(
    loadJsonCache<string[]>(matchesIndexPath, [])
  );

  const queriedPath = resolve(CACHE_DIR, `queried-puuids-${queueKey}.json`);
  const queriedPuuids = new Set<string>(
    loadJsonCache<string[]>(queriedPath, [])
  );

  const discoveredPath = resolve(
    CACHE_DIR,
    `discovered-puuids-${queueKey}.json`
  );
  const discoveredPuuids = new Set<string>(
    loadJsonCache<string[]>(discoveredPath, [])
  );

  if (matches.length >= TARGET_MATCHES) {
    console.log(
      `  Already have ${matches.length} matches for ${queueKey} (target: ${TARGET_MATCHES})`
    );
    return matches;
  }

  // Build initial queue: priority seeds first, then discovered, then fallback
  const puuidQueue: string[] = [];
  const queueSet = new Set<string>();
  const enqueue = (puuid: string) => {
    if (queriedPuuids.has(puuid)) return;
    if (queueSet.has(puuid)) return;
    puuidQueue.push(puuid);
    queueSet.add(puuid);
  };

  for (const p of prioritySeeds) enqueue(p);
  for (const p of discoveredPuuids) enqueue(p);
  for (const p of fallbackSeeds) enqueue(p);

  console.log(
    `  Snowball collecting for ${queueKey} (have ${matches.length} matches, ${puuidQueue.length} PUUIDs to query)...`
  );

  let savedAt = Date.now();
  const SAVE_INTERVAL_MS = 30_000;

  const persist = () => {
    saveJsonCache(matchIdsPath, [...matchIds]);
    saveJsonCache(matchesDataPath, matches);
    saveJsonCache(matchesIndexPath, [...fetchedMatchIds]);
    saveJsonCache(queriedPath, [...queriedPuuids]);
    saveJsonCache(discoveredPath, [...discoveredPuuids]);
    savedAt = Date.now();
  };

  const maybePersist = () => {
    if (Date.now() - savedAt >= SAVE_INTERVAL_MS) persist();
  };

  const updateProgress = () => {
    process.stdout.write(
      `\r  ${matches.length} matches / ${queriedPuuids.size} players queried / ${puuidQueue.length} pending...   `
    );
  };

  while (puuidQueue.length > 0 && matches.length < TARGET_MATCHES) {
    const puuid = puuidQueue.shift()!;
    queueSet.delete(puuid);
    if (queriedPuuids.has(puuid)) continue;

    // Step 1: Fetch this player's match IDs for the queue
    const listUrl =
      `${CONTINENTAL_HOST}/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?queue=${queueId}&count=${MATCHES_PER_PLAYER}`;
    const listRes = await rateLimitedFetch(listUrl);
    queriedPuuids.add(puuid);
    discoveredPuuids.delete(puuid);
    updateProgress();

    if (!listRes.ok) {
      maybePersist();
      continue;
    }

    const ids: string[] = await listRes.json();
    const newIds = ids.filter((id) => !matchIds.has(id));
    for (const id of ids) matchIds.add(id);

    // Step 2: For each NEW match, fetch details immediately. This is where
    // new PUUIDs come from — participants of each match get added to the
    // queue, which is how the snowball actually accelerates.
    for (const matchId of newIds) {
      if (matches.length >= TARGET_MATCHES) break;
      if (fetchedMatchIds.has(matchId)) continue;

      const detailUrl = `${CONTINENTAL_HOST}/lol/match/v5/matches/${matchId}`;
      const detailRes = await rateLimitedFetch(detailUrl);
      fetchedMatchIds.add(matchId);

      if (!detailRes.ok) {
        maybePersist();
        continue;
      }

      const raw = await detailRes.json();
      const match = extractMatchData(matchId, raw);
      if (match) {
        matches.push(match);

        // Add all participants to the queue (they've played this mode)
        for (const p of match.participants) {
          if (!queriedPuuids.has(p.puuid) && !queueSet.has(p.puuid)) {
            puuidQueue.push(p.puuid);
            queueSet.add(p.puuid);
            discoveredPuuids.add(p.puuid);
          }
        }
      }

      maybePersist();
      updateProgress();
    }

    maybePersist();
  }

  persist();
  console.log(`\n  Total matches for ${queueKey}: ${matches.length}`);
  return matches;
}

// ---------------------------------------------------------------------------
// Step 3: Fetch match details (used for ranked-solo, and as fallback for
// any match IDs collected but not yet fetched in the interleaved snowball)
// ---------------------------------------------------------------------------

async function fetchMatchDetails(
  matchIds: string[],
  queueKey: QueueKey
): Promise<MatchData[]> {
  const cacheDir = resolve(CACHE_DIR, `matches-${queueKey}`);
  ensureDir(cacheDir);

  // Load index of already-fetched match IDs
  const indexPath = resolve(cacheDir, "_index.json");
  const fetchedIds = new Set<string>(loadJsonCache<string[]>(indexPath, []));

  // Load existing match data
  const dataPath = resolve(cacheDir, "_data.json");
  const matches: MatchData[] = loadJsonCache<MatchData[]>(dataPath, []);

  const toFetch = matchIds.filter((id) => !fetchedIds.has(id));

  if (toFetch.length === 0) {
    console.log(
      `  All ${matchIds.length} matches already fetched for ${queueKey}`
    );
    return matches;
  }

  console.log(
    `  Fetching ${toFetch.length} match details for ${queueKey} (${fetchedIds.size} already cached)...`
  );

  let saveCounter = 0;
  let errorCount = 0;

  for (const matchId of toFetch) {
    const url = `${CONTINENTAL_HOST}/lol/match/v5/matches/${matchId}`;
    const res = await rateLimitedFetch(url);

    fetchedIds.add(matchId);

    if (!res.ok) {
      errorCount++;
      if (res.status === 404) continue; // Match expired from API
      if (errorCount > 20) {
        console.error("  Too many errors, stopping match fetch.");
        break;
      }
      continue;
    }

    const raw = await res.json();
    const match = extractMatchData(matchId, raw);
    if (match) {
      matches.push(match);

      // Discover new PUUIDs for snowball (save them for the snowball step)
      const discoveredPath = resolve(
        CACHE_DIR,
        `discovered-puuids-${queueKey}.json`
      );
      const discovered = new Set<string>(
        loadJsonCache<string[]>(discoveredPath, [])
      );
      for (const p of match.participants) {
        discovered.add(p.puuid);
      }
      // Only save discovered PUUIDs every 100 matches to avoid excessive writes
      if (saveCounter % 100 === 0) {
        saveJsonCache(discoveredPath, [...discovered]);
      }
    }

    saveCounter++;
    if (saveCounter % 100 === 0) {
      saveJsonCache(indexPath, [...fetchedIds]);
      saveJsonCache(dataPath, matches);
      process.stdout.write(
        `\r  ${matches.length} matches fetched (${saveCounter}/${toFetch.length})...`
      );
    }
  }

  // Final save
  saveJsonCache(indexPath, [...fetchedIds]);
  saveJsonCache(dataPath, matches);
  console.log(`\n  Total matches for ${queueKey}: ${matches.length}`);
  return matches;
}

// ---------------------------------------------------------------------------
// Step 4: Aggregate builds
// ---------------------------------------------------------------------------

interface BuildEntry {
  items: number[];
  runes: ParticipantData["perks"];
  wins: number;
  games: number;
}

interface ChampionBuilds {
  championName: string;
  sampleSize: number;
  builds: Array<{
    items: number[];
    perks: ParticipantData["perks"];
    winRate: number;
    pickRate: number;
    games: number;
  }>;
  /**
   * Per-champion augment stats (for Mayhem/Arena). Not used by the
   * item-catalog prompt work, but collected now so it's ready when we add
   * augment coaching later. Entries sorted by pick count descending.
   * Contains both popularity and win rate so the consumer can sort by
   * whichever dimension they need.
   */
  popularAugments?: Array<{
    augmentId: number;
    picks: number;
    wins: number;
    pickRate: number;
    winRate: number;
  }>;
}

interface MetaBuildOutput {
  patch: string;
  region: string;
  queueId: number;
  queueName: string;
  collectedAt: string;
  champions: Record<string, ChampionBuilds>;
}

/**
 * Create a normalized key for an item build (sorted item IDs, excluding 0s and trinket slot).
 * Items are in slots 0-5 (real items) and slot 6 (trinket).
 */
function buildKey(items: number[]): string {
  // Slots 0-5 are real items, slot 6 is trinket — exclude trinket and zeros
  return items
    .slice(0, 6)
    .filter((id) => id > 0)
    .sort((a, b) => a - b)
    .join(",");
}

/** Create a normalized key for a rune page */
function runeKey(perks: ParticipantData["perks"]): string {
  const perkIds: number[] = [];
  for (const style of perks.styles ?? []) {
    perkIds.push(style.style);
    for (const sel of style.selections ?? []) {
      perkIds.push(sel.perk);
    }
  }
  perkIds.push(perks.statPerks?.offense ?? 0);
  perkIds.push(perks.statPerks?.flex ?? 0);
  perkIds.push(perks.statPerks?.defense ?? 0);
  return perkIds.join(",");
}

/** Combined build+rune key for clustering */
function fullBuildKey(p: ParticipantData): string {
  return `${buildKey(p.items)}|${runeKey(p.perks)}`;
}

function aggregateBuilds(
  matches: MatchData[],
  queueKey: QueueKey
): MetaBuildOutput {
  const queue = QUEUES[queueKey];

  // Group participant data by champion
  const byChampion = new Map<number, ParticipantData[]>();
  for (const match of matches) {
    for (const p of match.participants) {
      // Skip participants with fewer than 3 completed items (remakes, early surrenders)
      const completedItems = p.items.slice(0, 6).filter((id) => id > 0).length;
      if (completedItems < 3) continue;

      const existing = byChampion.get(p.championId) ?? [];
      existing.push(p);
      byChampion.set(p.championId, existing);
    }
  }

  // Determine patch from the most common game version
  let patch = "unknown";
  if (matches.length > 0) {
    const versionCounts = new Map<string, number>();
    for (const m of matches) {
      // gameVersion is like "16.7.123.456" — first two parts are the patch
      const patchVersion = m.gameVersion.split(".").slice(0, 2).join(".");
      versionCounts.set(
        patchVersion,
        (versionCounts.get(patchVersion) ?? 0) + 1
      );
    }
    let maxCount = 0;
    for (const [v, c] of versionCounts) {
      if (c > maxCount) {
        patch = v;
        maxCount = c;
      }
    }
  }

  const champions: Record<string, ChampionBuilds> = {};

  for (const [championId, participants] of byChampion) {
    // Cluster by full build (items + runes)
    const clusters = new Map<string, BuildEntry>();
    for (const p of participants) {
      const key = fullBuildKey(p);
      const existing = clusters.get(key);
      if (existing) {
        existing.wins += p.win ? 1 : 0;
        existing.games += 1;
      } else {
        clusters.set(key, {
          items: p.items
            .slice(0, 6)
            .filter((id) => id > 0)
            .sort((a, b) => a - b),
          runes: p.perks,
          wins: p.win ? 1 : 0,
          games: 1,
        });
      }
    }

    // Sort by games played (popularity), take top 5
    const sorted = [...clusters.values()]
      .filter((c) => c.games >= 5) // Need minimum sample
      .sort((a, b) => b.games - a.games)
      .slice(0, 5);

    if (sorted.length === 0) continue;

    const champName = participants[0].championName;
    const totalGames = participants.length;

    // Aggregate augment stats across all participants for this champion.
    // Each participant can have up to 4 augments; track picks and wins per augment
    // so consumers can rank by popularity OR win rate.
    const augmentStats = new Map<number, { picks: number; wins: number }>();
    for (const p of participants) {
      for (const augId of p.augments) {
        const existing = augmentStats.get(augId) ?? { picks: 0, wins: 0 };
        existing.picks += 1;
        if (p.win) existing.wins += 1;
        augmentStats.set(augId, existing);
      }
    }
    const popularAugments = [...augmentStats.entries()]
      .sort((a, b) => b[1].picks - a[1].picks)
      .map(([augmentId, stats]) => ({
        augmentId,
        picks: stats.picks,
        wins: stats.wins,
        pickRate: totalGames > 0 ? stats.picks / totalGames : 0,
        winRate: stats.picks > 0 ? stats.wins / stats.picks : 0,
      }));

    champions[String(championId)] = {
      championName: champName,
      sampleSize: totalGames,
      builds: sorted.map((b) => ({
        items: b.items,
        perks: b.runes,
        winRate: b.games > 0 ? b.wins / b.games : 0,
        pickRate: totalGames > 0 ? b.games / totalGames : 0,
        games: b.games,
      })),
      ...(popularAugments.length > 0 ? { popularAugments } : {}),
    };
  }

  return {
    patch,
    region: "na1",
    queueId: queue.id,
    queueName: queue.name,
    collectedAt: new Date().toISOString(),
    champions,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(CACHE_DIR);
  ensureDir(OUTPUT_DIR);

  console.log(
    `=== Meta Build Data Collection${TEST_MODE ? " (TEST MODE)" : ""} ===\n`
  );

  if (TEST_MODE) {
    console.log(
      "  Test mode: limited to 10 players, 50 matches, ranked-solo only.\n"
    );
  }

  // Step 0: Resolve priority seed from Riot ID if provided
  const prioritySeeds: string[] = [];
  const seedRiotId = process.env.RIOT_SEED_ID;
  if (seedRiotId) {
    console.log(`[0/4] Resolving seed Riot ID: ${seedRiotId}...`);
    const puuid = await resolvePuuidFromRiotId(seedRiotId);
    if (puuid) {
      prioritySeeds.push(puuid);
      console.log(`  Priority seed resolved.`);
    }
  }

  // Step 1: Discover high-elo PUUIDs. Used for ranked-solo directly and as
  // snowball seeds for the casual queues (ARAM, Arena). Mayhem data is NOT
  // collected — Riot explicitly does not expose Mayhem match data through the
  // public Match-v5 API (returns 403, or reclassifies as queue 450 with
  // augments stripped). We use ARAM meta builds as the baseline for Mayhem
  // coaching, which matches how players approach it in practice.
  console.log("[1/3] Discovering high-elo players...");
  let highEloPuuids = await discoverHighEloPuuids();

  if (TEST_MODE) {
    highEloPuuids = highEloPuuids.slice(0, 10);
  }

  // Process each queue type sequentially — each completes fully (collection,
  // fetching, aggregation, output file) before moving to the next.
  const queueKeys: QueueKey[] = TEST_MODE
    ? ["ranked-solo"]
    : ["aram", "ranked-solo", "arena"];

  for (const queueKey of queueKeys) {
    const queue = QUEUES[queueKey];
    console.log(
      `\n[${queueKey}] Processing ${queue.name} (queue ${queue.id})...`
    );

    let matches: MatchData[];

    if (queueKey === "ranked-solo") {
      // Ranked: use the known-good high-elo player list, then fetch details.
      const matchIds = await collectMatchIds(highEloPuuids, queueKey);
      if (matchIds.length === 0) {
        console.log(`  No matches found for ${queueKey}. Skipping.`);
        continue;
      }
      matches = await fetchMatchDetails(matchIds, queueKey);
    } else {
      // Non-ranked (ARAM, Arena): interleaved snowball using high-elo players
      // as seeds. High-elo players do play these modes, and the snowball
      // expands from there via match participants.
      matches = await collectMatchesSnowball(
        prioritySeeds,
        highEloPuuids,
        queueKey
      );
    }

    if (matches.length === 0) {
      console.log(`  No match data for ${queueKey}. Skipping aggregation.`);
      continue;
    }

    // Aggregate and output
    console.log(`  Aggregating builds for ${queueKey}...`);
    const output = aggregateBuilds(matches, queueKey);
    const champCount = Object.keys(output.champions).length;
    const outputPath = resolve(OUTPUT_DIR, `${queueKey}.json`);
    saveJsonCache(outputPath, output);
    console.log(
      `  Wrote ${outputPath} (${champCount} champions, patch ${output.patch})`
    );
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
