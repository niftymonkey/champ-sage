/**
 * Audit live upstream data against the committed shape baseline.
 *
 * Run this at every patch boundary, before trusting anything the app says:
 *
 *   pnpm audit-upstream-drift              report drift, exit 1 if any
 *   pnpm audit-upstream-drift --update     accept what is live as the new baseline
 *   pnpm audit-upstream-drift --version X  read DDragon at patch X instead of latest
 *
 * `--version` pins the DDragon half of the read, which is how you reproduce a
 * past patch's shape or confirm that a check would have fired on a change you
 * already know about. Map and queue data always comes from CommunityDragon's
 * latest, which publishes no per-patch archive.
 *
 * The baseline lives in `scripts/upstream-baseline.json` and is reviewed like
 * code. `--update` is the moment a human decides "yes, Riot did that, and here
 * is what we changed in response", which is also the moment to add a row to
 * `docs/reference/upstream-changes.md`.
 *
 * See `upstream-drift.ts` for why the checks are shaped the way they are.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  compareUpstreamShape,
  summarizeChampions,
  summarizeItems,
  type UpstreamShape,
} from "./upstream-drift";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const CDRAGON =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";

const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "upstream-baseline.json"
);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return (await res.json()) as T;
}

interface CDragonMap {
  id: number;
  name: string;
}

interface CDragonQueue {
  id: number;
  name: string;
}

async function observeUpstreamShape(pinned?: string): Promise<UpstreamShape> {
  const versions = await getJson<string[]>(`${DDRAGON}/api/versions.json`);
  const version = pinned ?? versions[0];

  const [champions, items, maps, queues] = await Promise.all([
    getJson<unknown>(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`),
    getJson<unknown>(`${DDRAGON}/cdn/${version}/data/en_US/item.json`),
    getJson<CDragonMap[]>(`${CDRAGON}/maps.json`),
    getJson<CDragonQueue[]>(`${CDRAGON}/queues.json`),
  ]);

  return {
    ddragonVersion: version,
    ...summarizeChampions(champions),
    ...summarizeItems(items),
    maps: byId(maps),
    // Queues are the noisiest source and the most useful: a mode's queue name
    // ("ARAM: Mayhem Classic-ish") is usually the first human-readable notice
    // that it exists. Unnamed entries are internal placeholders, so skip them.
    queues: byId(queues.filter((queue) => queue.name)),
  };
}

function byId(entries: { id: number; name: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) out[String(entry.id)] = entry.name;
  return out;
}

function pinnedVersion(argv: string[]): string | undefined {
  const flag = argv.indexOf("--version");
  return flag === -1 ? undefined : argv[flag + 1];
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const observed = await observeUpstreamShape(pinnedVersion(process.argv));

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(observed, null, 2)}\n`);
    console.log(
      `Baseline updated to DDragon ${observed.ddragonVersion}.\n` +
        `Review the diff, then record what changed and what you did about it ` +
        `in docs/reference/upstream-changes.md.`
    );
    return;
  }

  const baseline = JSON.parse(
    readFileSync(BASELINE_PATH, "utf8")
  ) as UpstreamShape;
  const findings = compareUpstreamShape(baseline, observed);

  console.log(
    `Baseline DDragon ${baseline.ddragonVersion} | live DDragon ${observed.ddragonVersion}`
  );
  console.log(
    `Champions ${observed.championEntries} (${observed.canonicalChampions} canonical) | ` +
      `item namespaces ${Object.keys(observed.itemNamespaces).join(", ")} | ` +
      `map ids ${observed.itemMapIds.join(", ")}`
  );

  if (findings.length === 0) {
    console.log("\nNo upstream drift.");
    return;
  }

  console.log(`\n${findings.length} drift finding(s):\n`);
  for (const finding of findings) {
    console.log(`  [${finding.kind}] ${finding.detail}`);
  }
  console.log(
    `\nInvestigate each one before shipping. When they are understood and ` +
      `handled, run with --update and add a row to ` +
      `docs/reference/upstream-changes.md.`
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
