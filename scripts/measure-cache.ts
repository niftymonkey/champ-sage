/**
 * Measure the serialized size of the game-data cache payload.
 *
 * `writeCache` swallows quota errors silently (localStorage caps around 5MB
 * per origin in Chromium), so a payload that grows past the cap degrades to
 * "refetch everything on every start" with no error surfaced. This reports the
 * current size and the per-section breakdown so growth stays a decision rather
 * than a surprise.
 *
 * Usage: pnpm measure-cache
 */

import { fetchAndCache } from "../src/lib/data-ingest/index";
import { mapToObject } from "../src/lib/data-ingest/cache";

const KB = 1024;

function sizeOf(value: unknown): number {
  return JSON.stringify(value).length;
}

function report(label: string, bytes: number, total: number) {
  const pct = ((bytes / total) * 100).toFixed(1);
  console.log(
    `  ${label.padEnd(16)} ${(bytes / KB).toFixed(1).padStart(9)} KB  (${pct.padStart(5)}%)`
  );
}

async function main() {
  const data = await fetchAndCache();

  const champions = mapToObject(data.champions);

  // Mirror the exact object `fetchAndCache` hands to `writeCache`, so TOTAL is
  // the real persisted size (envelope and JSON overhead included) rather than
  // the sum of its parts. The per-section numbers below are only a breakdown.
  const payload = {
    version: data.version,
    champions,
    items: mapToObject(data.items),
    runes: data.runes,
    augments: mapToObject(data.augments),
    augmentSets: data.augmentSets,
    lastRefreshedAt: data.lastRefreshedAt,
  };
  const total = sizeOf(payload);

  const sections = {
    champions: sizeOf(champions),
    items: sizeOf(payload.items),
    runes: sizeOf(data.runes),
    augments: sizeOf(payload.augments),
    augmentSets: sizeOf(data.augmentSets),
  };

  console.log("\nCache payload breakdown:");
  for (const [label, bytes] of Object.entries(sections)) {
    report(label, bytes, total);
  }
  console.log(
    `  ${"TOTAL (payload)".padEnd(16)} ${(total / KB).toFixed(1).padStart(9)} KB`
  );

  const withAbilities = Object.values(champions).filter(
    (c) => c.abilities
  ).length;
  const abilitiesBytes = Object.values(champions).reduce(
    (sum, c) => sum + (c.abilities ? sizeOf(c.abilities) : 0),
    0
  );
  console.log(
    `\nChampions carrying abilities: ${withAbilities}/${Object.keys(champions).length}`
  );
  console.log(`Abilities share: ${(abilitiesBytes / KB).toFixed(1)} KB`);

  const LIMIT = 5 * 1024 * KB;
  console.log(
    `\nHeadroom vs a 5MB localStorage cap: ${((1 - total / LIMIT) * 100).toFixed(1)}% free`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
