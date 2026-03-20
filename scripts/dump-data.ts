import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchAndCache } from "../src/lib/data-ingest/index";
import type { AugmentMode } from "../src/lib/data-ingest/types";

const DUMP_DIR = join(import.meta.dirname, "..", "data-dump");

async function main() {
  mkdirSync(DUMP_DIR, { recursive: true });

  console.log("Loading game data (same pipeline as the app)...\n");
  const data = await fetchAndCache();

  // Champions
  const champList = [...data.champions.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  console.log(`=== Champions (${champList.length}) ===`);
  for (const c of champList) {
    console.log(`  ${c.name} — ${c.title} [${c.tags.join(", ")}]`);
  }

  // Items
  const itemList = [...data.items.values()].sort((a, b) =>
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
  console.log(`\n=== Runes (${data.runes.length} trees) ===`);
  for (const tree of data.runes) {
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
  const augList = [...data.augments.values()];
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
      const setLabel = a.sets.length > 0 ? ` [Sets: ${a.sets.join(", ")}]` : "";
      const idLabel = a.id != null ? ` (ID: ${a.id})` : "";
      console.log(`  ${a.name} [${a.tier}]${setLabel}${idLabel}`);
      console.log(`    ${desc}`);
    }
  }

  // Augment sets
  console.log(`\n=== Augment Sets (${data.augmentSets.length}) ===`);
  for (const set of data.augmentSets) {
    const bonusText = set.bonuses
      .map((b) => `${b.threshold}pc: ${b.description}`)
      .join(" | ");
    console.log(`  ${set.name}: ${bonusText}`);
  }

  // Entity dictionary
  console.log(`\n=== Entity Dictionary ===`);
  console.log(`Champions: ${data.dictionary.champions.length}`);
  console.log(`Items: ${data.dictionary.items.length}`);
  console.log(`Augments: ${data.dictionary.augments.length}`);
  console.log(`Total: ${data.dictionary.allNames.length}`);

  // Test a few searches
  console.log(`\n=== Search Tests ===`);
  for (const query of ["typhoon", "rabadons", "aurelion", "adapt"]) {
    const results = data.dictionary.search(query).slice(0, 3);
    console.log(
      `  "${query}" → ${results.map((r) => `${r.name} (${r.type}, ${r.score.toFixed(2)})`).join(", ")}`
    );
  }

  // Write raw JSON for inspection
  writeFileSync(
    join(DUMP_DIR, "all-data.json"),
    JSON.stringify(
      {
        version: data.version,
        championCount: data.champions.size,
        itemCount: data.items.size,
        runeTreeCount: data.runes.length,
        augmentSets: data.augmentSets,
        augmentsByMode: Object.fromEntries(
          [...byMode.entries()].map(([mode, list]) => [
            mode,
            list.map((a) => ({
              name: a.name,
              tier: a.tier,
              sets: a.sets,
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
