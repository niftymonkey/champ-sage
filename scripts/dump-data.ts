import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  fetchLatestVersion,
  fetchChampions,
  fetchItems,
  fetchRunes,
} from "../src/lib/data-ingest/sources/data-dragon";
import { fetchWikiAugments } from "../src/lib/data-ingest/sources/wiki-augments";
import { mergeAugmentIds } from "../src/lib/data-ingest/sources/community-dragon";
import { buildEntityDictionary } from "../src/lib/data-ingest/entity-dictionary";
import type { AugmentMode } from "../src/lib/data-ingest/types";

const DUMP_DIR = join(import.meta.dirname, "..", "data-dump");

async function main() {
  mkdirSync(DUMP_DIR, { recursive: true });

  console.log("Fetching latest version...");
  const version = await fetchLatestVersion();
  console.log(`Patch: ${version}\n`);

  console.log("Fetching champions, items, runes, augments...");
  const [champions, items, runes, augments] = await Promise.all([
    fetchChampions(version),
    fetchItems(version),
    fetchRunes(version),
    fetchWikiAugments(),
  ]);

  console.log("Merging CDragon augment data...");
  await mergeAugmentIds(augments);

  // Champions
  const champList = [...champions.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  console.log(`\n=== Champions (${champList.length}) ===`);
  for (const c of champList) {
    console.log(`  ${c.name} — ${c.title} [${c.tags.join(", ")}]`);
  }

  // Items
  const itemList = [...items.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const purchasable = itemList.filter((i) => i.gold.purchasable);
  console.log(
    `\n=== Items (${itemList.length} total, ${purchasable.length} purchasable) ===`
  );
  for (const item of purchasable) {
    console.log(`  [${item.id}] ${item.name} — ${item.gold.total}g`);
  }

  // Runes
  console.log(`\n=== Runes (${runes.length} trees) ===`);
  for (const tree of runes) {
    console.log(`  ${tree.name}`);
    console.log(
      `    Keystones: ${tree.keystones.map((r) => r.name).join(", ")}`
    );
    for (let i = 0; i < tree.slots.length; i++) {
      console.log(
        `    Row ${i + 1}: ${tree.slots[i].map((r) => r.name).join(", ")}`
      );
    }
  }

  // Augments by mode
  const augList = [...augments.values()];
  const byMode = new Map<AugmentMode, typeof augList>();
  for (const a of augList) {
    const list = byMode.get(a.mode) ?? [];
    list.push(a);
    byMode.set(a.mode, list);
  }

  console.log(`\n=== Augments (${augList.length} total) ===`);
  for (const mode of ["mayhem", "arena", "swarm", "unknown"] as AugmentMode[]) {
    const list = byMode.get(mode) ?? [];
    if (list.length === 0) continue;

    const sorted = list.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`\n  --- ${mode.toUpperCase()} (${sorted.length}) ---`);
    for (const a of sorted) {
      const desc = a.description
        ? a.description.slice(0, 60) + (a.description.length > 60 ? "..." : "")
        : "(no description)";
      const setLabel = a.set !== "-" ? ` [Set: ${a.set}]` : "";
      const idLabel = a.id != null ? ` (ID: ${a.id})` : "";
      console.log(`  ${a.name} [${a.tier}]${setLabel}${idLabel}`);
      console.log(`    ${desc}`);
    }
  }

  // Entity dictionary
  const dict = buildEntityDictionary(champions, items, augments);
  console.log(`\n=== Entity Dictionary ===`);
  console.log(`Champions: ${dict.champions.length}`);
  console.log(`Items: ${dict.items.length}`);
  console.log(`Augments: ${dict.augments.length}`);
  console.log(`Total: ${dict.allNames.length}`);

  // Test a few searches
  console.log(`\n=== Search Tests ===`);
  for (const query of ["typhoon", "rabadons", "aurelion", "adapt"]) {
    const results = dict.search(query).slice(0, 3);
    console.log(
      `  "${query}" → ${results.map((r) => `${r.name} (${r.type}, ${r.score.toFixed(2)})`).join(", ")}`
    );
  }

  // Write raw JSON for inspection
  writeFileSync(
    join(DUMP_DIR, "all-data.json"),
    JSON.stringify(
      {
        version,
        championCount: champions.size,
        itemCount: items.size,
        runeTreeCount: runes.length,
        augmentsByMode: Object.fromEntries(
          [...byMode.entries()].map(([mode, list]) => [
            mode,
            list.map((a) => ({
              name: a.name,
              tier: a.tier,
              set: a.set,
              mode: a.mode,
              id: a.id,
              hasDescription: !!a.description,
            })),
          ])
        ),
      },
      null,
      2
    )
  );

  console.log("\nDone. Summary written to data-dump/all-data.json");
}

main().catch(console.error);
