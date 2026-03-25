import { fetchAndCache } from "../src/lib/data-ingest";

async function main() {
  console.log("Loading game data...");
  const data = await fetchAndCache();
  console.log(`  ${data.augments.size} augments in dictionary\n`);

  const testQueries = [
    "My Augment options are Upgrade Collector, Goredrink, and Upgrade Immolate.",
    "Spiritual, Purification, Impassible, and Demon's Dance. Those are my options for Augments.",
    "I rerolled the other two and got Executioner and Apex Inventor alongside my Demon's Dance.",
    "Upgrade Infinity Edge, Typhoon, and Self Destruct",
  ];

  for (const query of testQueries) {
    console.log(`Query: "${query}"`);
    const matches = data.dictionary.findInText(query);
    const augmentMatches = matches.filter((m) => m.type === "augment");
    console.log(
      `  All matches (>= 0.7): ${matches.filter((m) => m.score >= 0.7).length}`
    );
    console.log(`  Augment matches (>= 0.7): ${augmentMatches.length}`);
    for (const m of augmentMatches) {
      console.log(`    "${m.name}" (score: ${m.score}, type: ${m.type})`);
    }

    // Also check lower threshold
    const looseAugments = matches.filter(
      (m) => m.type === "augment" && m.score >= 0.3
    );
    if (looseAugments.length > augmentMatches.length) {
      console.log(`  Augment matches (>= 0.3):`);
      for (const m of looseAugments) {
        console.log(`    "${m.name}" (score: ${m.score})`);
      }
    }
    console.log();
  }
}

main().catch(console.error);
