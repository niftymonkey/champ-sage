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
import {
  aggregateBuilds,
  countMatchesInWindow,
  selectRecentInWindowMatchIds,
  extractMatchData,
  type MatchData,
} from "../src/lib/meta-builds/aggregation";
import {
  fmtN,
  snowballProgressLines,
  barProgressLines,
} from "../src/lib/meta-builds/progress-format";
import {
  tallyChampionGames,
  buildReadinessReport,
  formatReadinessLine,
  formatReadinessReport,
  COLLECTION_GAME_TARGET,
} from "../src/lib/meta-builds/readiness";
import {
  keyFingerprint,
  shouldPurgePuuidCaches,
  isDecryptError,
} from "../src/lib/meta-builds/key-cache";
import { parseModesArg } from "../src/lib/meta-builds/collection-args";
import { DiscoveryQueue } from "../src/lib/meta-builds/discovery-queue";

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
  // Arena is queue 1750, NOT the 1700 in Riot's static queues.json. Riot reworked
  // Arena from 2v2v2v2 to a six-team format in patch 26.10 (16.10) and moved it to
  // a new queue ID without updating queues.json (which still lists only the dead
  // 1700 and 1710). Confirmed empirically: live Arena matches return gameMode
  // "CHERRY" under queueId 1750. The old 1700 has had no games since the rework.
  arena: { id: 1750, name: "Arena" },
} as const;

type QueueKey = keyof typeof QUEUES;

const TEST_MODE = process.argv.includes("--test");

/**
 * When --reset-queries is passed, move queried PUUIDs back into the discovered
 * pool so the snowball re-queries everyone under the current window. Useful
 * after the window widens or a long gap, when previously-queried players may
 * now have fresh matches worth re-listing. Match data and fetched match IDs are
 * preserved: we never throw away paid API work.
 */
const RESET_QUERIES = process.argv.includes("--reset-queries");

/** How many match IDs to request per player (max 100) */
const MATCHES_PER_PLAYER = TEST_MODE ? 20 : 100;

/**
 * The single wide collection window (in days), drained every run. Match-v5 has
 * no patch filter, so freshness is by DATE: a pass lists every reachable player
 * under `startTime = now - COLLECTION_WINDOW_DAYS` and fetches their in-window
 * matches, draining until the player queue is exhausted. 30 days captures the
 * recent multi-patch cushion (e.g. the current patch plus the prior one or two)
 * so a thin champion at selection time can backfill against recent data rather
 * than skipping past never-collected matches straight to an ancient cache. The
 * per-champion freshness ladder (FRESHNESS_LADDER_DAYS) still picks how far back
 * to build each champion from, but only at SELECTION time inside aggregateBuilds.
 */
const COLLECTION_WINDOW_DAYS = 30;

/**
 * Per-mode override of COLLECTION_WINDOW_DAYS. Arena uses a wider window: its
 * current 3v3 format only began in patch 16.10 (mid-May 2026), so the entire
 * format history is barely a month, it is a sparse mode, and a 30-day window can
 * miss the priority seed's recent Arena games (which is what blocks the cascade
 * from ever starting). Modes not listed use COLLECTION_WINDOW_DAYS.
 */
const MODE_WINDOW_DAYS: Partial<Record<QueueKey, number>> = { arena: 60 };

/**
 * After an API-key change, how many recent in-window cached matches to re-fetch
 * to recover new-key participant PUUIDs and rebuild the snowball frontier the
 * purge wiped. ~10 unique players each, so a few hundred reseeds a few thousand
 * frontier players, enough to restart the cascade in ~10 minutes.
 */
const KEY_CHANGE_BOOTSTRAP_MATCHES = 300;

/**
 * Saturation terminator: advance to the next mode once this many consecutive
 * queries add ZERO new matches. This is NOT a fixed cap, the mode collects
 * everything currently reachable, then stops only when there is genuinely
 * nothing new. That is what makes re-runs idempotent: they grab the day's new
 * games, saturate, and fall through cheaply instead of re-draining the whole
 * population. The longest dry streak observed during a healthy cascade was ~60,
 * so 500 will not cut an active collection short. Its one failure mode, a key
 * swap purging the frontier and looking like saturation, is handled upstream by
 * the frontier-rebuild bootstrap, which refills the frontier before this runs.
 */
const SATURATION_THRESHOLD = 500;

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
 * Convert a freshness window (in days) to the Match-v5 `startTime` value,
 * which is epoch SECONDS. (Riot's match `info.gameEndTimestamp`, by contrast,
 * is MILLISECONDS. Keep the units straight.) Computed against `Date.now()` at
 * the boundary so the pure layer never reads the clock.
 */
function startTimeSecondsForWindow(windowDays: number): number {
  return Math.floor(Date.now() / 1000) - windowDays * 24 * 60 * 60;
}

/** Epoch MILLISECONDS cutoff for a freshness window, for in-window counting. */
function windowCutoffMs(windowDays: number): number {
  return Date.now() - windowDays * 24 * 60 * 60 * 1000;
}

/**
 * How many recent minor patches to surface from Data Dragon. The newest
 * (element 0) is the target patch reported in the output; the others give
 * context. Selection itself is by date window, not by this list.
 */
const RECENT_PATCH_COUNT = 2;

/**
 * Fetch the most recent N unique major.minor patches from Data Dragon
 * (e.g. ["16.7", "16.6"]). Element 0 is the target patch used for the output's
 * freshness metrics. Cached after first fetch.
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

/**
 * Count of "Exception decrypting" 400s seen this run. Riot rejects PUUIDs
 * encrypted for a different API key this way; more than a handful means the
 * PUUID caches are poisoned for the current key. The fingerprint purge in
 * ensureKeyFingerprint() normally prevents this; this guard is the backstop.
 */
let decryptErrorCount = 0;
const DECRYPT_ERROR_LIMIT = 10;

/**
 * Unified result type from `rateLimitedFetch`. The body is read inside the
 * helper so body-read errors (socket closed mid-stream, etc.) get caught by
 * the same retry loop as connection errors — previously these escaped.
 *
 * - `ok: true` → request succeeded, `data` is the parsed JSON response
 * - `ok: false` → non-retryable HTTP error (404 typically), `status` set
 */
interface FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
}

async function rateLimitedFetch(
  url: string,
  retries = 5
): Promise<FetchResult> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const retryOnError = async (err: Error): Promise<FetchResult> => {
    if (retries > 0) {
      const backoffSec = (6 - retries) * 5; // 5s, 10s, 15s, 20s, 25s
      console.warn(
        `  Network error: ${err.message}. Retrying in ${backoffSec}s... (${retries} retries left)`
      );
      await sleep(backoffSec * 1000);
      return rateLimitedFetch(url, retries - 1);
    }
    throw err;
  };

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Riot-Token": API_KEY! },
      // 30s request timeout — fail fast on hung requests so we can retry
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Connection-level errors: network, timeout, reset
    return retryOnError(err as Error);
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
  if (res.status >= 500 && res.status < 600) {
    if (retries > 0) {
      const backoffSec = (6 - retries) * 5;
      console.warn(
        `  Server error ${res.status}. Retrying in ${backoffSec}s... (${retries} retries left)`
      );
      await sleep(backoffSec * 1000);
      return rateLimitedFetch(url, retries - 1);
    }
    return { ok: false, status: res.status, data: null };
  }

  // Poisoned-PUUID guard: Riot rejects a PUUID encrypted for a different API
  // key with a 400 "Exception decrypting". The fingerprint purge in
  // ensureKeyFingerprint() normally prevents this; if a wall of them slips
  // through, abort loudly rather than silently treating each as "no matches"
  // and grinding the rate limit against a dead pool.
  if (res.status === 400) {
    let message: string | undefined;
    try {
      const body = (await res.json()) as { status?: { message?: string } };
      message = body?.status?.message;
    } catch {
      // Non-JSON 400 body: leave the message undefined.
    }
    if (isDecryptError(400, message)) {
      decryptErrorCount++;
      if (decryptErrorCount >= DECRYPT_ERROR_LIMIT) {
        console.error(
          `\n\nFATAL: ${decryptErrorCount} "Exception decrypting" 400s. Your cached PUUIDs were encrypted for a different API key.`
        );
        console.error(
          `  The key-fingerprint purge should prevent this. If you see it, delete the puuid caches`
        );
        console.error(
          `  (puuids-high-elo.json, discovered-puuids-*.json, queried-puuids-*.json) and re-run.\n`
        );
        process.exit(1);
      }
    }
    return { ok: false, status: 400, data: null };
  }

  // Non-retryable HTTP error (404 etc.): return without a body read
  if (!res.ok) {
    return { ok: false, status: res.status, data: null };
  }

  // Read the body. Socket errors mid-stream (SocketError: other side closed,
  // Fetch.onAborted) throw here, NOT from the fetch() call above. Catch them
  // the same way as connection errors so they retry.
  try {
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return retryOnError(err as Error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Status line helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Live progress region
//
// A block of one or more lines redrawn in place via `\r` and ANSI cursor moves.
// Any permanent log line must call clearLiveRegion() first so the in-place block
// does not corrupt it; the next renderLiveRegion() redraws the block below
// whatever was printed. This is what lets a multi-line progress display coexist
// with periodic summary/aggregation lines in a single terminal.
// ---------------------------------------------------------------------------

// In-place rendering only makes sense on a TTY. When stdout is piped or
// redirected (e.g. into a log file), ANSI cursor moves would be written
// literally, so the live region is suppressed and only the permanent lines and
// periodic summaries appear.
const INTERACTIVE = process.stdout.isTTY === true;

let liveRegionLines = 0;

/**
 * Erase the in-place live progress block (if any) and leave the cursor at the
 * column-0 start of where the block began, ready for a permanent print or a
 * redraw. Safe to call when nothing is rendered.
 */
function clearLiveRegion(): void {
  if (!INTERACTIVE) return;
  if (liveRegionLines === 0) {
    process.stdout.write("\r\x1b[K");
    return;
  }
  process.stdout.write("\r\x1b[K");
  for (let i = 1; i < liveRegionLines; i++) {
    process.stdout.write("\x1b[1A\x1b[K");
  }
  liveRegionLines = 0;
}

/**
 * Draw a multi-line live block in place (no trailing newline) and remember how
 * many lines it spans so the next clear knows what to erase. A no-op off-TTY.
 */
function renderLiveRegion(lines: string[]): void {
  if (!INTERACTIVE) return;
  clearLiveRegion();
  process.stdout.write(lines.join("\n"));
  liveRegionLines = lines.length;
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
  clearLiveRegion();
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
  clearLiveRegion();
  console.log(
    `  📊 ${totalMatches} matches → ${championsCovered} champions covered (patch ${patch}) → ${outputPath}`
  );
}

// Data interfaces (ParticipantData, MatchData, BuildEntry, ChampionBuilds,
// MetaBuildOutput) and the pure helpers extractMatchData / aggregateBuilds /
// countMatchesInWindow now live in src/lib/meta-builds/aggregation.ts. This
// script owns the I/O loops and passes Date.now() at the boundary.

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
  const data = res.data as { puuid: string };
  return data.puuid;
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
    const data = res.data as { entries?: Array<{ puuid?: string }> };
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
    const entries = res.data as Array<{ puuid?: string }>;
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
  queueKey: QueueKey,
  startTimeSeconds: number
): Promise<string[]> {
  const queueId = QUEUES[queueKey].id;
  const cachePath = resolve(CACHE_DIR, `match-ids-${queueKey}.json`);
  const matchIds = new Set<string>(loadJsonCache<string[]>(cachePath, []));

  // List IDs for every not-yet-queried player in the (bounded) ranked pool
  // under this window's startTime. No total-ID cap: the in-window stop lives
  // in fetchMatchDetails, which is the only place a match's gameEndTimestamp
  // is known. Between ladder rungs the queried set is reset, so a wider window
  // re-lists the same players and surfaces their older match IDs.
  console.log(
    `  Collecting match IDs for ${queueKey} (have ${matchIds.size})...`
  );

  // Track which PUUIDs we've already queried for this queue
  const queriedPath = resolve(CACHE_DIR, `queried-puuids-${queueKey}.json`);
  const queriedPuuids = new Set<string>(
    loadJsonCache<string[]>(queriedPath, [])
  );

  let saveCounter = 0;
  let consecutiveZeroNew = 0;

  for (const puuid of puuids) {
    if (queriedPuuids.has(puuid)) continue;

    const url =
      `${CONTINENTAL_HOST}/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?queue=${queueId}&count=${MATCHES_PER_PLAYER}&startTime=${startTimeSeconds}`;

    const res = await rateLimitedFetch(url);
    queriedPuuids.add(puuid);

    if (!res.ok) {
      if (res.status === 404) continue; // Player has no matches for this queue
      console.warn(`  Match list fetch failed for PUUID: ${res.status}`);
      continue;
    }

    const ids = res.data as string[];
    const before = matchIds.size;
    for (const id of ids) matchIds.add(id);

    // Saturation terminator (mirrors the snowball): advance once the bounded
    // ranked pool stops yielding new match IDs, so re-runs fall through fast.
    consecutiveZeroNew = matchIds.size > before ? 0 : consecutiveZeroNew + 1;
    if (consecutiveZeroNew >= SATURATION_THRESHOLD) {
      saveJsonCache(cachePath, [...matchIds]);
      saveJsonCache(queriedPath, [...queriedPuuids]);
      console.log(
        `\n  ${queueKey} match-id collection saturated: ${SATURATION_THRESHOLD} queries with no new IDs. Have ${fmtN(
          matchIds.size
        )}. Advancing.`
      );
      break;
    }

    // Persist incrementally every 50 players
    saveCounter++;
    if (saveCounter % 50 === 0) {
      saveJsonCache(cachePath, [...matchIds]);
      saveJsonCache(queriedPath, [...queriedPuuids]);
      renderLiveRegion(
        barProgressLines({
          done: queriedPuuids.size,
          total: puuids.length,
          label: "players listed",
          subtitle: `${fmtN(matchIds.size)} match IDs gathered so far`,
        })
      );
    }
  }

  // Final save
  saveJsonCache(cachePath, [...matchIds]);
  saveJsonCache(queriedPath, [...queriedPuuids]);
  clearLiveRegion();
  console.log(`  Total match IDs for ${queueKey}: ${fmtN(matchIds.size)}`);
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
  recentPatches: string[],
  startTimeSeconds: number,
  cutoffMs: number,
  keyChanged: boolean
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

  // In-window match count, maintained incrementally for diagnostics and the
  // end-of-pass log only. This is NOT a collection cap: the pass drains its
  // window until the player queue is exhausted, so the fresh bucket grows
  // without a ceiling and keeps climbing across runs.
  let inWindowCount = countMatchesInWindow(matches, cutoffMs);

  // Track which source each PUUID came from so we can understand snowball
  // dynamics in the log output.
  type PuuidSource = "priority" | "discovered" | "fallback" | "new";
  const puuidSource = new Map<string, PuuidSource>();

  // Three-tier discovery queue, drained frontier -> seed -> stale. The FRONTIER
  // holds priority seeds (e.g. the user's own mode account) plus every player
  // discovered inside the freshness window this run, so the snowball chases the
  // mode-playing population immediately. The SEED tier holds the high-elo
  // fallback seeds: reliable accounts but mostly ranked players who rarely ARAM,
  // so they are entry points used to discover frontier players, not the main
  // source. The STALE tier holds the prior-run discovered pool, a backstop. This
  // ordering stops the run from grinding ~11k mostly-non-ARAM high-elo seeds
  // before reaching the discovered ARAM players. The queue owns dedup across all
  // tiers, replacing the old queueSet.
  const queue = new DiscoveryQueue();
  const enqueueFrontier = (puuid: string, source: PuuidSource) => {
    if (queriedPuuids.has(puuid)) return;
    if (queue.has(puuid)) return;
    queue.enqueueFrontier(puuid);
    puuidSource.set(puuid, source);
  };
  const enqueueSeed = (puuid: string, source: PuuidSource) => {
    if (queriedPuuids.has(puuid)) return;
    if (queue.has(puuid)) return;
    queue.enqueueSeed(puuid);
    puuidSource.set(puuid, source);
  };
  const enqueueStale = (puuid: string, source: PuuidSource) => {
    if (queriedPuuids.has(puuid)) return;
    if (queue.has(puuid)) return;
    queue.enqueueStale(puuid);
    puuidSource.set(puuid, source);
  };

  // Frontier: priority seeds. Seed: high-elo fallback. Stale: discovered pool.
  for (const p of prioritySeeds) enqueueFrontier(p, "priority");
  for (const p of fallbackSeeds) enqueueSeed(p, "fallback");
  for (const p of discoveredPuuids) enqueueStale(p, "discovered");

  console.log(
    `  Starting with ${fmtN(matches.length)} matches cached, ${fmtN(
      queue.size
    )} players queued to check for new ones.`
  );

  // Key-change frontier rebuild. A key swap purges the discovered-player pool
  // (those PUUIDs are encrypted to the old key) and the cached matches' own
  // participant PUUIDs are likewise old-key, so re-querying known players only
  // returns already-cached matches and the cascade cannot restart. Re-fetch the
  // most recent in-window cached matches PURELY to recover their participants
  // under the new key (a match ID is global, so the fetch returns new-key
  // PUUIDs) and seed them into the frontier. Most are unqueried "edge" players
  // with uncached matches, so the cascade restarts in minutes instead of
  // limping off the few games played since the cache was built.
  if (keyChanged && matches.length > 0) {
    const bootstrapIds = selectRecentInWindowMatchIds(
      matches,
      cutoffMs,
      KEY_CHANGE_BOOTSTRAP_MATCHES
    );
    if (bootstrapIds.length > 0) {
      console.log(
        `  Key changed: rebuilding frontier from ${fmtN(
          bootstrapIds.length
        )} recent cached matches (recovers new-key PUUIDs)...`
      );
      const frontierBefore = queue.frontierSize;
      let refetched = 0;
      for (const matchId of bootstrapIds) {
        const res = await rateLimitedFetch(
          `${CONTINENTAL_HOST}/lol/match/v5/matches/${matchId}`
        );
        refetched++;
        if (res.ok) {
          const match = extractMatchData(
            matchId,
            res.data as Record<string, unknown>
          );
          if (match) {
            for (const p of match.participants) enqueueFrontier(p.puuid, "new");
          }
        }
        // Live counter so the ~10-minute rate-limited rebuild does not look hung.
        renderLiveRegion([
          `  Rebuilding frontier: ${fmtN(refetched)}/${fmtN(
            bootstrapIds.length
          )} matches re-fetched, ${fmtN(
            queue.frontierSize - frontierBefore
          )} new-key players recovered...`,
        ]);
      }
      clearLiveRegion();
      console.log(
        `  Recovered ${fmtN(
          queue.frontierSize - frontierBefore
        )} new-key players into the frontier.`
      );
    }
  }

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
      resumedMatches: matches.length,
      resumedInWindow: inWindowCount,
      resumedPlayersQueried: queriedPuuids.size,
      seedsPending: queue.size,
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
  // Set once every champion seen has reached COLLECTION_GAME_TARGET in-window
  // games. Checked at the periodic-aggregation cadence; when true the snowball
  // stops early (the per-champion game floor is the real "done" signal for the
  // presence pool). Saturation/exhaustion stays the backstop, and in practice
  // this rarely fires because rare champions may never reach the target in one
  // freshness window, so the readiness REPORT naming laggards is the main tool.
  let readinessReached = false;

  let lastAggregatedAtCount = Math.floor(matches.length / 1000) * 1000;
  const maybeAggregatePeriodically = () => {
    const currentThousand = Math.floor(matches.length / 1000) * 1000;
    if (currentThousand <= lastAggregatedAtCount) return;
    lastAggregatedAtCount = currentThousand;

    const output = aggregateBuilds(
      matches,
      QUEUES[queueKey],
      recentPatches,
      Date.now()
    );
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

    // Per-champion collection readiness against the convergence target. Printed
    // as a permanent line so progress toward "enough games per champion" is
    // visible during the long run, and used to arm the early stop above.
    const readiness = buildReadinessReport(
      tallyChampionGames(matches, cutoffMs),
      COLLECTION_GAME_TARGET
    );
    clearLiveRegion();
    console.log(formatReadinessLine(readiness));
    logQuery({
      event: "readiness",
      totalChampions: readiness.totalChampions,
      readyCount: readiness.readyCount,
      target: readiness.target,
      rarest: readiness.rarest,
      allReady: readiness.allReady,
    });
    if (readiness.allReady) readinessReached = true;
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
    const recentAvg = rollingWindow.length
      ? rollingWindow.reduce((sum, e) => sum + e.matchesAdded, 0) /
        rollingWindow.length
      : 0;
    renderLiveRegion(
      snowballProgressLines({
        inWindowCount,
        totalMatches: matches.length,
        playersChecked: queriedPuuids.size,
        queueSize: queue.size,
        recentMatchesPerQuery: recentAvg,
      })
    );
  };

  // Drain the window: advance when no players remain (queue exhaustion) OR the
  // mode saturates (SATURATION_THRESHOLD consecutive queries add no new matches,
  // i.e. everything reachable is already cached). Neither is a fixed cap; both
  // mean "nothing left to collect". FRONTIER drains before SEED before STALE, so
  // the live frontier is chased first. A for-loop (not while) is used so every
  // `continue` advances the queue via the update expression before re-testing.
  let consecutiveZeroNew = 0;
  // Track how the loop actually terminates so the end-of-run log is accurate:
  // the for-loop running out means the queue drained; the saturation break
  // below means a long dry run. They are not the same outcome.
  let endReason = "queue-exhausted";
  for (let puuid = queue.next(); puuid !== undefined; puuid = queue.next()) {
    if (queriedPuuids.has(puuid)) continue;
    const source = puuidSource.get(puuid) ?? "new";

    // Step 1: Fetch this player's match IDs for the queue
    const listUrl =
      `${CONTINENTAL_HOST}/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?queue=${queueId}&count=${MATCHES_PER_PLAYER}&startTime=${startTimeSeconds}`;
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
        queueSizeAfter: queue.size,
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

    const ids = listRes.data as string[];
    const newIds = ids.filter((id) => !matchIds.has(id));
    for (const id of ids) matchIds.add(id);

    let detailsFetchedThisQuery = 0;
    let detailsFailedThisQuery = 0;
    const matchesBefore = matches.length;

    // Step 2: For each NEW match, fetch details immediately. This is where
    // new PUUIDs come from — participants of each match get added to the
    // queue, which is how the snowball actually accelerates.
    for (const matchId of newIds) {
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

      const raw = detailRes.data as Record<string, unknown>;
      const match = extractMatchData(matchId, raw);
      if (match) {
        matches.push(match);
        appendMatchJsonl(matchesJsonlPath, match);
        // Incrementally track the in-window count that gates this pass. The
        // API's startTime already scopes fetched IDs to the window, but we
        // count against gameEndTimestamp directly so cross-window cache reuse
        // stays correct.
        if (match.gameEndTimestamp >= cutoffMs) inWindowCount++;

        // Add all participants to the FRONTIER tier: they played this mode
        // inside the window, so they are the highest-yield players to query next
        // and jump ahead of the unprocessed high-elo seeds. discoveredPuuids is
        // still seeded for the NEXT run's stale pool; that cross-run memory is
        // unchanged.
        for (const p of match.participants) {
          if (!queriedPuuids.has(p.puuid) && !queue.has(p.puuid)) {
            queue.enqueueFrontier(p.puuid);
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

    // Saturation terminator (see SATURATION_THRESHOLD). A productive query resets
    // the counter; a long dry run means the window is fully collected, so stop
    // and let the next mode run. The key-change bootstrap above keeps a purged
    // frontier from masquerading as saturation here.
    consecutiveZeroNew = matchesAddedThisQuery > 0 ? 0 : consecutiveZeroNew + 1;
    if (consecutiveZeroNew >= SATURATION_THRESHOLD) {
      endReason = "saturated";
      clearLiveRegion();
      console.log(
        `  ${queueKey} saturated: ${SATURATION_THRESHOLD} queries with no new matches. ${fmtN(
          matches.length
        )} cached (${fmtN(inWindowCount)} in-window). Advancing.`
      );
      break;
    }

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
      queueSizeAfter: queue.size,
    });

    // Early stop: every champion seen has reached the per-champion game target,
    // armed at the periodic-aggregation cadence above. Checked AFTER this query's
    // success log (unlike the saturation break above) so the final productive
    // query is still recorded before we stop. The post-loop persist() flushes
    // state regardless.
    if (readinessReached) {
      endReason = "all-champions-ready";
      clearLiveRegion();
      console.log(
        `  ${queueKey}: every champion reached ${COLLECTION_GAME_TARGET} games. ${fmtN(
          matches.length
        )} cached. Stopping.`
      );
      break;
    }

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

      // Count remaining queue by source so we know what's left to process.
      // pending() walks both tiers (live first, then stale), so the breakdown
      // and the queueSize summary reflect the full queue, not one tier.
      const queueBySource: Record<PuuidSource, number> = {
        priority: 0,
        discovered: 0,
        fallback: 0,
        new: 0,
      };
      for (const p of queue.pending()) {
        queueBySource[puuidSource.get(p) ?? "new"]++;
      }

      const summaryEvent: SummaryEvent = {
        playersQueried: queriedPuuids.size,
        totalMatches: matches.length,
        queueSize: queue.size,
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
    inWindowMatches: inWindowCount,
    totalPlayersQueried: queriedPuuids.size,
    queueSize: queue.size,
    reason: endReason,
  });
  clearLiveRegion();
  console.log(
    `  Total matches for ${queueKey}: ${fmtN(matches.length)} (${fmtN(
      inWindowCount
    )} in-window)`
  );
  return matches;
}

// ---------------------------------------------------------------------------
// Step 3: Fetch match details (used for ranked-solo, and as fallback for
// any match IDs collected but not yet fetched in the interleaved snowball)
// ---------------------------------------------------------------------------

async function fetchMatchDetails(
  matchIds: string[],
  queueKey: QueueKey,
  cutoffMs: number
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

  // In-window match count, tracked incrementally for the end-of-pass log only.
  // Not a collection cap: every collected match ID is fetched (deduped via the
  // index), so the fresh bucket grows without a ceiling.
  let inWindowCount = countMatchesInWindow(matches, cutoffMs);

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

    const raw = res.data as Record<string, unknown>;
    const match = extractMatchData(matchId, raw);
    if (match) {
      matches.push(match);
      appendMatchJsonl(jsonlDataPath, match);
      if (match.gameEndTimestamp >= cutoffMs) inWindowCount++;

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
      renderLiveRegion(
        barProgressLines({
          done: saveCounter,
          total: toFetch.length,
          label: "match details fetched",
          subtitle: `${fmtN(matches.length)} total cached · ${fmtN(
            inWindowCount
          )} in-window`,
        })
      );
    }
  }

  // Final save (matches already persisted line-by-line via appendMatchJsonl)
  saveJsonCache(indexPath, [...fetchedIds]);
  clearLiveRegion();
  console.log(
    `  Total matches for ${queueKey}: ${fmtN(matches.length)} (${fmtN(
      inWindowCount
    )} in-window)`
  );
  return matches;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Move every queried PUUID for a queue back into the discovered pool and clear
 * the queried list, so the next pass re-lists them under the current window.
 * Nothing is deleted: match data and fetched-match IDs are preserved. This is
 * what --reset-queries triggers at startup, to re-surface players' fresh
 * matches after a window change or a long gap.
 */
function resetQueriesForQueue(queueKey: QueueKey): void {
  const queriedPath = resolve(CACHE_DIR, `queried-puuids-${queueKey}.json`);
  const discoveredPath = resolve(
    CACHE_DIR,
    `discovered-puuids-${queueKey}.json`
  );

  const queried = loadJsonCache<string[]>(queriedPath, []);
  const discovered = new Set(loadJsonCache<string[]>(discoveredPath, []));

  for (const p of queried) discovered.add(p);
  saveJsonCache(discoveredPath, [...discovered]);

  if (existsSync(queriedPath)) unlinkSync(queriedPath);

  console.log(
    `    ${queueKey}: migrated ${queried.length} queried -> discovered now has ${discovered.size}`
  );
}

/**
 * The cache files whose contents are PUUIDs encrypted to a specific API key:
 * the high-elo seed list, the snowball discovered pool, and the queried set.
 * Match data (match IDs, details, logs) is keyed by global match IDs and is NOT
 * key-scoped, so it is deliberately excluded and survives a key change.
 */
function puuidCachePaths(): string[] {
  const files = ["puuids-high-elo.json"];
  for (const qk of ["aram", "ranked-solo", "arena"]) {
    files.push(`discovered-puuids-${qk}.json`, `queried-puuids-${qk}.json`);
  }
  return files.map((f) => resolve(CACHE_DIR, f));
}

/**
 * Purge the key-scoped PUUID caches when the API key changed since the last run.
 * Riot encrypts PUUIDs to the key that fetched them, and dev keys rotate every
 * 24 hours, so a PUUID cached under the old key returns 400 "Exception
 * decrypting" under the new one. Match data is preserved; only the PUUID caches
 * are dropped, and the current key's fingerprint is recorded for next time.
 * Returns true when a purge happened (key changed), so the snowball can rebuild
 * its frontier from cached matches instead of limping off sparse new games.
 */
function ensureKeyFingerprint(): boolean {
  const fpPath = resolve(CACHE_DIR, ".key-fingerprint");
  const currentFp = keyFingerprint(API_KEY!);
  const storedFp = existsSync(fpPath)
    ? readFileSync(fpPath, "utf-8").trim()
    : null;

  if (!shouldPurgePuuidCaches(storedFp, currentFp)) return false;

  console.log(
    storedFp !== null
      ? "  API key changed since last run: purging PUUID caches (encrypted for the previous key). Match data is preserved."
      : "  No key fingerprint on record: purging PUUID caches to be safe. Match data is preserved."
  );
  for (const p of puuidCachePaths()) {
    if (existsSync(p)) unlinkSync(p);
  }
  writeFileSync(fpPath, currentFp);
  return true;
}

async function main() {
  ensureDir(CACHE_DIR);
  ensureDir(OUTPUT_DIR);
  const keyChanged = ensureKeyFingerprint();

  console.log(
    `=== Meta Build Data Collection${TEST_MODE ? " (TEST MODE)" : ""} ===\n`
  );

  if (TEST_MODE) {
    console.log(
      "  Test mode: limited to 10 players, 50 matches, ranked-solo only.\n"
    );
  }

  // --reset-queries at startup re-queries everyone under the current window,
  // re-surfacing fresh matches for players queried before the window moved.
  if (RESET_QUERIES) {
    console.log("  --reset-queries: moving queried PUUIDs back into discovery");
    for (const qk of ["aram", "ranked-solo", "arena"] as const) {
      resetQueriesForQueue(qk);
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

  // Fetch recent patches once. Element 0 is the target patch surfaced in the
  // output's freshness metrics; selection itself is by date window.
  const recentPatches = await getRecentPatches();
  console.log(
    `\nRecent patches (target = ${recentPatches[0] ?? "unknown"}): ${recentPatches.join(", ")}`
  );
  console.log(
    `Collection window: last ${COLLECTION_WINDOW_DAYS} days (drained every run) | selection ladder owned by aggregation\n`
  );

  // Process each queue type sequentially. `--modes aram,arena` restricts the
  // run to specific modes so a finished one (e.g. ARAM already collected) can be
  // skipped without waiting for its huge snowball to drain.
  const allModes: QueueKey[] = TEST_MODE
    ? ["ranked-solo"]
    : ["aram", "ranked-solo", "arena"];
  const requestedModes = parseModesArg(process.argv, allModes);
  const queueKeys: QueueKey[] = requestedModes ?? allModes;
  if (requestedModes) {
    console.log(`Modes (from --modes): ${queueKeys.join(", ")}\n`);
  }

  for (const queueKey of queueKeys) {
    const queue = QUEUES[queueKey];
    const modeNum = queueKeys.indexOf(queueKey) + 1;

    // One wide collection window per mode, drained every run (no per-window
    // target or widen-or-stop ladder). MODE_WINDOW_DAYS lets a mode override the
    // default; the per-champion freshness ladder in aggregateBuilds still picks
    // how far back to build each champion from at selection time.
    const windowDays = MODE_WINDOW_DAYS[queueKey] ?? COLLECTION_WINDOW_DAYS;
    const startTimeSeconds = startTimeSecondsForWindow(windowDays);
    const cutoffMs = windowCutoffMs(windowDays);

    console.log(
      `\n━━━ ${queue.name} ━━━  (mode ${modeNum} of ${queueKeys.length})`
    );
    if (queueKey === "aram") {
      console.log(
        "Recent ARAM matches (also the baseline for ARAM Mayhem coaching)."
      );
    }
    console.log(
      `Collecting every reachable match from the last ${windowDays} days.`
    );

    let matches: MatchData[] = [];

    if (queueKey === "ranked-solo") {
      const matchIds = await collectMatchIds(
        highEloPuuids,
        queueKey,
        startTimeSeconds
      );
      if (matchIds.length === 0) {
        console.log(`  No match IDs yet for ${queueKey}.`);
      } else {
        matches = await fetchMatchDetails(matchIds, queueKey, cutoffMs);
      }
    } else {
      matches = await collectMatchesSnowball(
        prioritySeeds,
        highEloPuuids,
        queueKey,
        recentPatches,
        startTimeSeconds,
        cutoffMs,
        keyChanged
      );
    }

    const inWindowCount = countMatchesInWindow(matches, cutoffMs);
    console.log(
      `  After ${windowDays}d window: ${fmtN(
        inWindowCount
      )} fresh / ${fmtN(matches.length)} cached`
    );

    if (matches.length === 0) {
      console.log(`  No match data for ${queueKey}. Skipping aggregation.`);
      continue;
    }

    // Aggregate and output. Writes to a staging file (`<queue>.new.json`)
    // rather than clobbering the live file. After the run finishes, promote
    // manually: delete the old file and rename the .new file in its place.
    console.log(`  Aggregating builds for ${queueKey}...`);
    const output = aggregateBuilds(
      matches,
      QUEUES[queueKey],
      recentPatches,
      Date.now()
    );
    const champCount = Object.keys(output.champions).length;
    const outputPath = resolve(OUTPUT_DIR, `${queueKey}.new.json`);
    saveJsonCache(outputPath, output);
    console.log(
      `  Wrote ${outputPath} (${champCount} champions, target patch ${output.targetPatch}, fresh share ${(output.freshPatchShare * 100).toFixed(1)}%)`
    );

    // Per-champion readiness against the convergence target, naming the laggards
    // so the user can judge whether the tail is good enough or another pass is
    // worth it. Rare champions may never reach the target in one window.
    const readiness = buildReadinessReport(
      tallyChampionGames(matches, cutoffMs),
      COLLECTION_GAME_TARGET
    );
    for (const line of formatReadinessReport(readiness)) {
      console.log(`  ${line}`);
    }
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
