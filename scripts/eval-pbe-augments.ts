/**
 * Offline evaluation of PBE augment changes against live, for one mode
 * (Mayhem by default). Runs the real ingest source functions, never touches
 * the app's localStorage cache, and writes patchline-namespaced dumps plus a
 * diff report. Safe to run anytime: it shares no state with the running app,
 * so it cannot affect or lose data from a live game.
 *
 * Run: pnpm eval-pbe
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchWikiAugments } from "../src/lib/data-ingest/sources/wiki-augments";
import { fetchCDragonAugments } from "../src/lib/data-ingest/sources/community-dragon";
import { getMayhemAugmentSets } from "../src/lib/data-ingest/sources/mayhem-augment-sets";
import { buildAugmentPatchlineReport } from "../src/lib/data-ingest/augment-patchline-report";

const DUMP_DIR = join(import.meta.dirname, "..", "data-dump");

function pct(described: number, total: number): string {
  if (total === 0) return "n/a";
  return `${Math.round((described / total) * 100)}%`;
}

function names(list: { name: string }[]): string {
  return list
    .map((a) => a.name)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

async function main() {
  for (const sub of ["live", "pbe", "diff"]) {
    mkdirSync(join(DUMP_DIR, sub), { recursive: true });
  }

  console.log("Fetching wiki (live) + CDragon (live, pbe)...\n");
  const [wikiAugments, liveCDragon, pbeCDragon] = await Promise.all([
    fetchWikiAugments(),
    fetchCDragonAugments("live"),
    fetchCDragonAugments("pbe"),
  ]);

  const knownSetNames = getMayhemAugmentSets().map((s) => s.name);

  const report = buildAugmentPatchlineReport({
    base: liveCDragon,
    candidate: pbeCDragon,
    wikiAugments,
    knownSetNames,
    mode: "mayhem",
  });

  console.log(`=== Mayhem augments: live vs PBE ===`);
  console.log(`  live:      ${report.baseCount}`);
  console.log(`  pbe:       ${report.candidateCount}`);
  console.log(
    `  added (by id):   ${report.addedById.length}   added (by name): ${report.addedByName.length}`
  );
  console.log(`  removed:         ${report.removed.length}`);
  console.log(`  rarity changed:  ${report.rarityChanged.length}`);

  console.log(`\n=== Import readiness ===`);
  console.log(
    `  PBE-new augments lacking a wiki description: ${report.addedMissingWiki.length}/${report.addedByName.length}`
  );
  console.log(`    ${names(report.addedMissingWiki) || "(none)"}`);
  console.log(
    `  wiki coverage of full PBE roster: ${report.wikiCoverage.described}/${report.wikiCoverage.total} (${pct(
      report.wikiCoverage.described,
      report.wikiCoverage.total
    )})`
  );
  console.log(
    `  total would-be-dropped, incl. pre-existing quest augments: ${report.droppedForMissingDescription.length}`
  );

  console.log(`\n=== Grouping mechanic ===`);
  console.log(
    `  wiki augments still carrying set membership: ${report.grouping.wikiSetMembershipCount}`
  );
  console.log(
    `  hardcoded set names now standalone PBE augments: ${
      report.grouping.repurposedSetNames.join(", ") || "(none)"
    }`
  );
  if (report.grouping.repurposedSetNames.length > 0) {
    console.log(
      `  NOTE: getMayhemAugmentSets() is hardcoded. Set-bonus coaching will be stale on the new version.`
    );
  }

  if (report.rarityChanged.length > 0) {
    console.log(`\n=== Rarity changes ===`);
    for (const c of report.rarityChanged) {
      console.log(`  ${c.name}: ${c.from} -> ${c.to}`);
    }
  }

  writeFileSync(
    join(DUMP_DIR, "live", "cdragon-augments.json"),
    JSON.stringify(liveCDragon, null, 2)
  );
  writeFileSync(
    join(DUMP_DIR, "pbe", "cdragon-augments.json"),
    JSON.stringify(pbeCDragon, null, 2)
  );
  writeFileSync(
    join(DUMP_DIR, "diff", "mayhem-report.json"),
    JSON.stringify(report, null, 2)
  );

  console.log(
    `\nDone. Raw rosters in data-dump/{live,pbe}/, report in data-dump/diff/mayhem-report.json`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
