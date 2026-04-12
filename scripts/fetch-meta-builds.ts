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
import { basename, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";

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

/**
 * When --reset-queries is passed, delete the queried-puuids and
 * discovered-puuids caches so the snowball re-queries everyone with the
 * current time window. Use this after changing MATCH_WINDOW_DAYS or when
 * you want fresh data from the existing seed pool. Match data and fetched
 * match IDs are preserved — we never throw away paid API work.
 */
const RESET_QUERIES = process.argv.includes("--reset-queries");

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

/**
 * How far back in time to include matches. Matches older than this window are
 * excluded via the Match-v5 API's `startTime` filter, so we never even fetch
 * their details — this is what keeps the dataset scoped to the current patch.
 *
 * 60 days gives enough headroom for small/mid patches while still filtering
 * out genuinely stale data from months ago. Large patch cycles with big item
 * reworks may want a shorter window.
 */
const MATCH_WINDOW_DAYS = 60;
const MATCH_WINDOW_SECONDS = MATCH_WINDOW_DAYS * 24 * 60 * 60;

/**
 * Epoch timestamp (seconds) marking the start of the collection window.
 * Passed as the `startTime` parameter to `matches/by-puuid/{puuid}/ids` so
 * we only get match IDs from the last MATCH_WINDOW_DAYS days. Computed once
 * at script start so all queries use the same window.
 */
const startTimeEpoch = Math.floor(Date.now() / 1000) - MATCH_WINDOW_SECONDS;

/**
 * How many recent minor patches to include in aggregation. With a 60-day
 * match window, a value of 2 typically covers the current and previous
 * patch, giving us a meaningful dataset even right after a patch drops.
 */
const RECENT_PATCH_COUNT = 2;

/**
 * Fetch the most recent N unique major.minor patches from Data Dragon
 * (e.g. ["16.7", "16.6"]). Matches whose gameVersion starts with any of
 * these are included at aggregation time; older matches are excluded.
 * Cached after first fetch.
 */
let recentPatchesCache: string[] | null = null;
async function getRecentPatches(): Promise<string[]> {
  if (recentPatchesCache) return recentPatchesCache;
  const res = await fetch(
    "https://ddragon.leagueoflegends.com/api/versions.json"
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Data Dragon version: ${res.status}`);
  }
  const versions: string[] = await res.json();

  // versions.json is ordered newest-first. Walk it and collect unique
  // major.minor prefixes until we have RECENT_PATCH_COUNT of them.
  const seen: string[] = [];
  for (const v of versions) {
    const patch = v.split(".").slice(0, 2).join(".");
    if (!seen.includes(patch)) seen.push(patch);
    if (seen.length >= RECENT_PATCH_COUNT) break;
  }
  recentPatchesCache = seen;
  return recentPatchesCache;
}

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

  // Fatal auth errors — bail immediately. Dev API keys expire every 24 hours,
  // and without this check the script would silently waste every remaining
  // request against an expired key until hitting the 24-hour mark.
  //
  // 401: Unauthorized (key expired, malformed, or missing)
  // 403: Forbidden (key rejected — can also happen for region-blocked resources
  //      like Mayhem, but since we no longer query Mayhem, any 403 is fatal)
  if (res.status === 401 || res.status === 403) {
    console.error(
      `\n\nFATAL: Riot API returned ${res.status} ${res.statusText} for ${url}`
    );
    console.error(
      `  This almost always means your RIOT_API_KEY in .env has expired.`
    );
    console.error(`  Dev keys expire every 24 hours — grab a fresh one at:`);
    console.error(`    https://developer.riotgames.com`);
    console.error(
      `  Then update .env and re-run \`pnpm fetch-meta\`. All progress is cached.\n`
    );
    process.exit(1);
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
// Status line helpers
// ---------------------------------------------------------------------------

/**
 * Clear the current line (progress counter) before printing a full line so
 * the progress counter's `\r`-overwrite doesn't corrupt the output.
 */
function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

/**
 * Print a formatted summary line for one of the diagnostic events also
 * written to the JSONL log file. Kept in the same file as the fetch logic
 * (rather than a separate watch script) so one terminal shows everything.
 */
interface SummaryEvent {
  playersQueried: number;
  totalMatches: number;
  queueSize: number;
  last100: {
    matchesAdded: number;
    avgMatchesPerQuery: number;
    bySource: Record<string, { queries: number; matchesAdded: number }>;
    idsReturnedDistribution: Record<string, number>;
    detailFailureRate: number;
  };
}

function printSummary(e: SummaryEvent): void {
  clearLine();
  const bySource = Object.entries(e.last100.bySource)
    .filter(([, v]) => v.queries > 0)
    .map(([k, v]) => `${k}:${v.queries}q/${v.matchesAdded}m`)
    .join(" ");
  const ids = e.last100.idsReturnedDistribution;
  const idsStr = `[0:${ids.zero} 1-10:${ids["1-10"]} 11-50:${ids["11-50"]} 51-99:${ids["51-99"]} 100:${ids["100"]}]`;
  const avg = Math.round(e.last100.avgMatchesPerQuery * 100) / 100;
  const failRate = Math.round(e.last100.detailFailureRate * 1000) / 10;
  console.log(
    `  📈 ${e.playersQueried} queried | ${e.totalMatches} matches | queue: ${e.queueSize}`
  );
  console.log(
    `       last 100: +${e.last100.matchesAdded} matches (avg ${avg}/query, ${failRate}% fail)`
  );
  console.log(`       by source: ${bySource || "(none)"}`);
  console.log(`       ids returned: ${idsStr}`);
}

function printPeriodicAggregation(
  totalMatches: number,
  championsCovered: number,
  patch: string,
  outputPath: string
): void {
  clearLine();
  console.log(
    `  📊 ${totalMatches} matches → ${championsCovered} champions covered (patch ${patch}) → ${outputPath}`
  );
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
// JSONL cache for match data
//
// JSON arrays don't scale past ~25k matches because JSON.stringify hits
// V8's max string length (~512MB). Match data is stored as newline-delimited
// JSON instead: one match per line, appended immediately as it's fetched.
// - No size limit (file system is the limit)
// - Crash-safe (each match is durable the moment it's appended)
// - Faster (no periodic full-file rewrites)
// - Stream-readable on load (no giant string buffer)
// ---------------------------------------------------------------------------

/** Append a single match to a JSONL file (one line per match). */
function appendMatchJsonl(path: string, match: MatchData): void {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(match) + "\n");
}

/** Stream-load all matches from a JSONL file. */
async function loadMatchesJsonl(path: string): Promise<MatchData[]> {
  if (!existsSync(path)) return [];
  const matches: MatchData[] = [];
  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      matches.push(JSON.parse(line) as MatchData);
    } catch {
      // Skip corrupted lines (e.g. partial writes from a crash mid-append).
    }
  }
  return matches;
}

/**
 * Migrate an existing legacy JSON array cache to JSONL format. Preserves
 * the old file so the user can roll back; the migration is idempotent and
 * only runs when the JSONL target doesn't exist yet.
 */
async function migrateLegacyMatchCache(
  legacyJsonPath: string,
  jsonlPath: string
): Promise<void> {
  if (existsSync(jsonlPath)) return;
  if (!existsSync(legacyJsonPath)) return;

  console.log(`  Migrating legacy match cache → ${basename(jsonlPath)}`);
  const legacy = JSON.parse(readFileSync(legacyJsonPath, "utf-8"));
  if (!Array.isArray(legacy)) return;

  ensureDir(dirname(jsonlPath));
  // Write each match as its own line. Chunk writes to keep memory reasonable.
  const CHUNK = 1000;
  for (let i = 0; i < legacy.length; i += CHUNK) {
    const chunk = legacy
      .slice(i, i + CHUNK)
      .map((m) => JSON.stringify(m))
      .join("\n");
    appendFileSync(jsonlPath, chunk + "\n");
  }
  console.log(
    `    Migrated ${legacy.length} matches. Legacy file preserved at ${basename(legacyJsonPath)} — delete when ready.`
  );
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
      `?queue=${queueId}&count=${MATCHES_PER_PLAYER}&startTime=${startTimeEpoch}`;

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
  queueKey: QueueKey,
  recentPatches: string[]
): Promise<MatchData[]> {
  const queueId = QUEUES[queueKey].id;

  const matchIdsPath = resolve(CACHE_DIR, `match-ids-${queueKey}.json`);
  const matchIds = new Set<string>(loadJsonCache<string[]>(matchIdsPath, []));

  const matchesDir = resolve(CACHE_DIR, `matches-${queueKey}`);
  ensureDir(matchesDir);
  const matchesLegacyPath = resolve(matchesDir, "_data.json");
  const matchesJsonlPath = resolve(matchesDir, "_data.jsonl");
  const matchesIndexPath = resolve(matchesDir, "_index.json");

  // One-time migration from legacy JSON array format to JSONL.
  await migrateLegacyMatchCache(matchesLegacyPath, matchesJsonlPath);

  const matches: MatchData[] = await loadMatchesJsonl(matchesJsonlPath);
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

  // Track which source each PUUID came from so we can understand snowball
  // dynamics in the log output.
  type PuuidSource = "priority" | "discovered" | "fallback" | "new";
  const puuidSource = new Map<string, PuuidSource>();

  // Build initial queue: priority seeds first, then discovered, then fallback
  const puuidQueue: string[] = [];
  const queueSet = new Set<string>();
  const enqueue = (puuid: string, source: PuuidSource) => {
    if (queriedPuuids.has(puuid)) return;
    if (queueSet.has(puuid)) return;
    puuidQueue.push(puuid);
    queueSet.add(puuid);
    puuidSource.set(puuid, source);
  };

  for (const p of prioritySeeds) enqueue(p, "priority");
  for (const p of discoveredPuuids) enqueue(p, "discovered");
  for (const p of fallbackSeeds) enqueue(p, "fallback");

  console.log(
    `  Snowball collecting for ${queueKey} (have ${matches.length} matches, ${puuidQueue.length} PUUIDs to query)...`
  );

  // --- Per-query diagnostic logging ---
  //
  // Writes one JSON line per query to a log file so we can analyze snowball
  // efficiency offline (e.g. to spot saturation, where a batch of players is
  // returning zero new matches). Tail the file while the script runs:
  //   tail -f data/meta-builds/.cache/fetch-log-<queueKey>.jsonl
  const logFilePath = resolve(CACHE_DIR, `fetch-log-${queueKey}.jsonl`);
  appendFileSync(
    logFilePath,
    JSON.stringify({
      t: new Date().toISOString(),
      event: "start",
      queueKey,
      targetMatches: TARGET_MATCHES,
      resumedMatches: matches.length,
      resumedPlayersQueried: queriedPuuids.size,
      seedsPending: puuidQueue.length,
      sources: {
        priority: prioritySeeds.length,
        discovered: discoveredPuuids.size,
        fallback: fallbackSeeds.length,
      },
    }) + "\n"
  );

  // Rolling window to detect saturation. If the last N queries produce zero
  // new matches, something is wrong (or we've exhausted reachable space).
  const EFFICIENCY_WINDOW = 100;
  interface RollingEntry {
    source: PuuidSource;
    idsReturned: number;
    matchesAdded: number;
    detailsFetched: number;
    detailsFailed: number;
  }
  const rollingWindow: RollingEntry[] = [];

  const logQuery = (entry: Record<string, unknown>) => {
    appendFileSync(
      logFilePath,
      JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n"
    );
  };

  // Periodic aggregation: every time matches.length crosses a multiple of
  // 1000, run aggregation and write to a staging file (e.g. `aram.new.json`)
  // alongside the existing output (`aram.json`). The live app keeps using
  // the existing file until the collection run is complete, at which point
  // the user manually promotes the new file (delete old, rename .new). This
  // keeps the app stable while new data is being built up.
  let lastAggregatedAtCount = Math.floor(matches.length / 1000) * 1000;
  const maybeAggregatePeriodically = () => {
    const currentThousand = Math.floor(matches.length / 1000) * 1000;
    if (currentThousand <= lastAggregatedAtCount) return;
    lastAggregatedAtCount = currentThousand;

    const output = aggregateBuilds(matches, queueKey, recentPatches);
    const outputPath = resolve(OUTPUT_DIR, `${queueKey}.new.json`);
    saveJsonCache(outputPath, output);

    const champCount = Object.keys(output.champions).length;
    logQuery({
      event: "periodicAggregation",
      totalMatches: matches.length,
      championsCovered: champCount,
      patch: output.patch,
      outputPath: `${queueKey}.new.json`,
    });
    printPeriodicAggregation(
      matches.length,
      champCount,
      output.patch,
      `${queueKey}.new.json`
    );
  };

  let savedAt = Date.now();
  const SAVE_INTERVAL_MS = 30_000;

  // Note: matches are appended to the JSONL file as they're fetched (below),
  // not batched here. persist() only writes the small auxiliary state files.
  const persist = () => {
    saveJsonCache(matchIdsPath, [...matchIds]);
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
    const source = puuidSource.get(puuid) ?? "new";

    // Step 1: Fetch this player's match IDs for the queue
    const listUrl =
      `${CONTINENTAL_HOST}/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?queue=${queueId}&count=${MATCHES_PER_PLAYER}&startTime=${startTimeEpoch}`;
    const listRes = await rateLimitedFetch(listUrl);
    queriedPuuids.add(puuid);
    discoveredPuuids.delete(puuid);
    updateProgress();

    const pushRolling = (entry: RollingEntry) => {
      rollingWindow.push(entry);
      if (rollingWindow.length > EFFICIENCY_WINDOW) rollingWindow.shift();
    };

    if (!listRes.ok) {
      logQuery({
        event: "query",
        puuid,
        source,
        status: listRes.status,
        idsReturned: 0,
        newIds: 0,
        detailsFetched: 0,
        matchesAfter: matches.length,
        queueSizeAfter: puuidQueue.length,
      });
      pushRolling({
        source,
        idsReturned: 0,
        matchesAdded: 0,
        detailsFetched: 0,
        detailsFailed: 0,
      });
      maybePersist();
      continue;
    }

    const ids: string[] = await listRes.json();
    const newIds = ids.filter((id) => !matchIds.has(id));
    for (const id of ids) matchIds.add(id);

    let detailsFetchedThisQuery = 0;
    let detailsFailedThisQuery = 0;
    const matchesBefore = matches.length;

    // Step 2: For each NEW match, fetch details immediately. This is where
    // new PUUIDs come from — participants of each match get added to the
    // queue, which is how the snowball actually accelerates.
    for (const matchId of newIds) {
      if (matches.length >= TARGET_MATCHES) break;
      if (fetchedMatchIds.has(matchId)) continue;

      const detailUrl = `${CONTINENTAL_HOST}/lol/match/v5/matches/${matchId}`;
      const detailRes = await rateLimitedFetch(detailUrl);
      fetchedMatchIds.add(matchId);
      detailsFetchedThisQuery++;

      if (!detailRes.ok) {
        detailsFailedThisQuery++;
        maybePersist();
        continue;
      }

      const raw = await detailRes.json();
      const match = extractMatchData(matchId, raw);
      if (match) {
        matches.push(match);
        appendMatchJsonl(matchesJsonlPath, match);

        // Add all participants to the queue (they've played this mode)
        for (const p of match.participants) {
          if (!queriedPuuids.has(p.puuid) && !queueSet.has(p.puuid)) {
            puuidQueue.push(p.puuid);
            queueSet.add(p.puuid);
            puuidSource.set(p.puuid, "new");
            discoveredPuuids.add(p.puuid);
          }
        }

        // Run aggregation every 1000 matches so the app has fresh data
        // without waiting for the full collection to complete.
        maybeAggregatePeriodically();
      }

      maybePersist();
      updateProgress();
    }

    const matchesAddedThisQuery = matches.length - matchesBefore;
    pushRolling({
      source,
      idsReturned: ids.length,
      matchesAdded: matchesAddedThisQuery,
      detailsFetched: detailsFetchedThisQuery,
      detailsFailed: detailsFailedThisQuery,
    });

    logQuery({
      event: "query",
      puuid,
      source,
      status: 200,
      idsReturned: ids.length,
      newIds: newIds.length,
      detailsFetched: detailsFetchedThisQuery,
      detailsFailed: detailsFailedThisQuery,
      matchesAdded: matchesAddedThisQuery,
      matchesAfter: matches.length,
      queueSizeAfter: puuidQueue.length,
    });

    // Every 100 queries, write a rich summary showing rolling efficiency
    // broken down by source and ID-return distribution. This is the key
    // diagnostic for spotting saturation and understanding which part of
    // the queue is productive.
    if (queriedPuuids.size % 100 === 0) {
      const bySource: Record<
        PuuidSource,
        { queries: number; matchesAdded: number }
      > = {
        priority: { queries: 0, matchesAdded: 0 },
        discovered: { queries: 0, matchesAdded: 0 },
        fallback: { queries: 0, matchesAdded: 0 },
        new: { queries: 0, matchesAdded: 0 },
      };
      const idBuckets = {
        zero: 0,
        "1-10": 0,
        "11-50": 0,
        "51-99": 0,
        "100": 0,
      };
      let totalMatchesAdded = 0;
      let totalDetailsFetched = 0;
      let totalDetailsFailed = 0;

      for (const entry of rollingWindow) {
        bySource[entry.source].queries++;
        bySource[entry.source].matchesAdded += entry.matchesAdded;
        totalMatchesAdded += entry.matchesAdded;
        totalDetailsFetched += entry.detailsFetched;
        totalDetailsFailed += entry.detailsFailed;

        if (entry.idsReturned === 0) idBuckets.zero++;
        else if (entry.idsReturned <= 10) idBuckets["1-10"]++;
        else if (entry.idsReturned <= 50) idBuckets["11-50"]++;
        else if (entry.idsReturned < 100) idBuckets["51-99"]++;
        else idBuckets["100"]++;
      }

      // Count remaining queue by source so we know what's left to process
      const queueBySource: Record<PuuidSource, number> = {
        priority: 0,
        discovered: 0,
        fallback: 0,
        new: 0,
      };
      for (const p of puuidQueue) {
        queueBySource[puuidSource.get(p) ?? "new"]++;
      }

      const summaryEvent: SummaryEvent = {
        playersQueried: queriedPuuids.size,
        totalMatches: matches.length,
        queueSize: puuidQueue.length,
        last100: {
          matchesAdded: totalMatchesAdded,
          avgMatchesPerQuery:
            rollingWindow.length > 0
              ? totalMatchesAdded / rollingWindow.length
              : 0,
          bySource,
          idsReturnedDistribution: idBuckets,
          detailFailureRate:
            totalDetailsFetched > 0
              ? totalDetailsFailed / totalDetailsFetched
              : 0,
        },
      };
      logQuery({
        event: "summary",
        ...summaryEvent,
        queueBySource,
        last100: {
          ...summaryEvent.last100,
          detailsFetched: totalDetailsFetched,
          detailsFailed: totalDetailsFailed,
        },
      });
      printSummary(summaryEvent);
    }

    maybePersist();
  }

  persist();
  logQuery({
    event: "end",
    totalMatches: matches.length,
    totalPlayersQueried: queriedPuuids.size,
    queueSize: puuidQueue.length,
    reason:
      matches.length >= TARGET_MATCHES ? "target-reached" : "queue-exhausted",
  });
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

  // Load existing match data (migrating from legacy JSON if needed)
  const legacyDataPath = resolve(cacheDir, "_data.json");
  const jsonlDataPath = resolve(cacheDir, "_data.jsonl");
  await migrateLegacyMatchCache(legacyDataPath, jsonlDataPath);
  const matches: MatchData[] = await loadMatchesJsonl(jsonlDataPath);

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
      appendMatchJsonl(jsonlDataPath, match);

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
      process.stdout.write(
        `\r  ${matches.length} matches fetched (${saveCounter}/${toFetch.length})...`
      );
    }
  }

  // Final save (matches already persisted line-by-line via appendMatchJsonl)
  saveJsonCache(indexPath, [...fetchedIds]);
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

/**
 * Cluster key for grouping "same build" participants. Items only — runes
 * intentionally excluded because including them makes clusters too granular
 * (a single stat shard difference produces a different cluster, so 134
 * samples can spread across 130 distinct clusters and no cluster hits the
 * minimum threshold). Rune data still collected and stored for future rune
 * coaching work; we just don't cluster on it.
 */
function fullBuildKey(p: ParticipantData): string {
  return buildKey(p.items);
}

// Keep runeKey for potential future use (rune coaching) — not called here.
void runeKey;

function aggregateBuilds(
  matches: MatchData[],
  queueKey: QueueKey,
  recentPatches: string[]
): MetaBuildOutput {
  const queue = QUEUES[queueKey];
  const patchSet = new Set(recentPatches);

  // Filter to only matches from recent patches. Matches in the cache from
  // older patches are preserved (don't want to waste that data) but excluded
  // from the output so the meta reflects what's actually current.
  //
  // gameVersion is like "16.7.123.456"; we match on the first two parts.
  const filteredMatches = matches.filter((m) => {
    const p = m.gameVersion.split(".").slice(0, 2).join(".");
    return patchSet.has(p);
  });

  // Group participant data by champion
  const byChampion = new Map<number, ParticipantData[]>();
  for (const match of filteredMatches) {
    for (const p of match.participants) {
      // Skip participants with fewer than 3 completed items (remakes, early surrenders)
      const completedItems = p.items.slice(0, 6).filter((id) => id > 0).length;
      if (completedItems < 3) continue;

      const existing = byChampion.get(p.championId) ?? [];
      existing.push(p);
      byChampion.set(p.championId, existing);
    }
  }

  // The output patch label is the most recent patch (first in the list).
  // The aggregation itself may include matches from a few recent patches.
  const patch = recentPatches[0] ?? "unknown";

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

    // Filter out losing builds, then sort by popularity. Win rate is used
    // as a quality filter, not a sort key — win rate sorting on small samples
    // is mostly noise (n=5 has a 95% CI of ±44%). Popularity sorting gives
    // a broader item pool, which is what we want for the LLM's tier 1 pool.
    //
    // Threshold of 2 games keeps noise low. 0.45 win rate excludes genuinely
    // losing builds while giving small-sample builds some benefit of the doubt.
    const sorted = [...clusters.values()]
      .filter((c) => {
        if (c.games < 2) return false;
        const winRate = c.wins / c.games;
        return winRate >= 0.45;
      })
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);

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

  // --reset-queries: move every PUUID we've ever queried back into the
  // "discovered" pool so the snowball re-queries them with the current time
  // window. We do NOT delete anything — we migrate. This preserves every
  // PUUID we've discovered (including snowball expansions from prior runs)
  // while marking them all as "not yet queried under the new filter."
  if (RESET_QUERIES) {
    console.log("  --reset-queries: moving queried PUUIDs back into discovery");
    for (const qk of ["aram", "ranked-solo", "arena"] as const) {
      const queriedPath = resolve(CACHE_DIR, `queried-puuids-${qk}.json`);
      const discoveredPath = resolve(CACHE_DIR, `discovered-puuids-${qk}.json`);

      const queried = loadJsonCache<string[]>(queriedPath, []);
      const discovered = new Set(loadJsonCache<string[]>(discoveredPath, []));

      // Migrate queried PUUIDs into discovered
      for (const p of queried) discovered.add(p);
      saveJsonCache(discoveredPath, [...discovered]);

      // Clear the queried list so everyone gets re-queried
      if (existsSync(queriedPath)) unlinkSync(queriedPath);

      console.log(
        `    ${qk}: migrated ${queried.length} queried → discovered now has ${discovered.size}`
      );
    }
    console.log();
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

  // Fetch recent patches once — used for filtering matches during aggregation
  // so the output only includes games on current + previous patches (item
  // meta rarely shifts dramatically between minor patches in the same season).
  const recentPatches = await getRecentPatches();
  console.log(
    `\nRecent patches (included in output): ${recentPatches.join(", ")}`
  );
  console.log(
    `Match window: last ${MATCH_WINDOW_DAYS} days (startTime=${startTimeEpoch})\n`
  );

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
        queueKey,
        recentPatches
      );
    }

    if (matches.length === 0) {
      console.log(`  No match data for ${queueKey}. Skipping aggregation.`);
      continue;
    }

    // Aggregate and output. Writes to a staging file (`<queue>.new.json`)
    // rather than clobbering the live file. After the run finishes, promote
    // manually: delete the old file and rename the .new file in its place.
    console.log(`  Aggregating builds for ${queueKey}...`);
    const output = aggregateBuilds(matches, queueKey, recentPatches);
    const champCount = Object.keys(output.champions).length;
    const outputPath = resolve(OUTPUT_DIR, `${queueKey}.new.json`);
    saveJsonCache(outputPath, output);
    console.log(
      `  Wrote ${outputPath} (${champCount} champions, patch ${output.patch})`
    );
  }

  console.log("\n=== Done ===");
  console.log("\nStaging files written to `src/data/meta-builds/*.new.json`.");
  console.log(
    "After reviewing, promote manually: delete the old .json and rename .new.json to .json."
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
