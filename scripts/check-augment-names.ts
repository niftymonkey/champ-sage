import { fetchWikiAugments } from "../src/lib/data-ingest/sources/wiki-augments";
import { fetchArenaAugments } from "../src/lib/data-ingest/sources/wiki-arena-augments";

async function main() {
  console.log("Fetching Mayhem augments...");
  const mayhem = await fetchWikiAugments();
  console.log(`  ${mayhem.size} Mayhem augments\n`);

  const targets = [
    "collector",
    "goredrink",
    "goredrinker",
    "immolate",
    "demon",
    "spiritual",
    "purification",
    "impassible",
    "executioner",
    "apex",
  ];

  console.log("Searching for target augment names:");
  for (const target of targets) {
    const matches = [...mayhem.entries()].filter(
      ([key, aug]) =>
        key.includes(target) || aug.name.toLowerCase().includes(target)
    );
    if (matches.length > 0) {
      for (const [key, aug] of matches) {
        console.log(
          `  FOUND "${aug.name}" (key: "${key}") — ${aug.description.substring(0, 100)}`
        );
      }
    } else {
      console.log(`  NO MATCH for "${target}"`);
    }
  }

  console.log("\nAll augments containing 'upgrade':");
  for (const [key, aug] of mayhem) {
    if (aug.name.toLowerCase().includes("upgrade")) {
      console.log(`  "${aug.name}" (key: "${key}")`);
    }
  }

  console.log("\nAll augments containing 'dance':");
  for (const [key, aug] of mayhem) {
    if (aug.name.toLowerCase().includes("dance")) {
      console.log(`  "${aug.name}" (key: "${key}")`);
    }
  }
}

main().catch(console.error);
