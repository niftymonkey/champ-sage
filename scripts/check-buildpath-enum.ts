/**
 * Verify the game-plan build-path name enum is healthy per mode.
 *
 * The enum is mode-level, not champion-level: `createGamePlanFeature` filters
 * the catalog through `isBuildPathEligible(item, mode)` once per mode, so the
 * same enum serves every champion in that mode. A broken mode filter corners
 * the model for ALL champions (observed: ARAM collapsed to 21 mana/enchanter
 * variants, producing a Winter's Approach x6 build). This script checks the
 * eligible set against the real catalog so the enum can be validated without a
 * live game and independent of which champion is played.
 *
 * Run: pnpm check-buildpath-enum  (exits non-zero on any failure)
 */
import { fetchAndCache } from "../src/lib/data-ingest/index";
import { isBuildPathEligible } from "../src/lib/ai/item-catalog";
import { aramMayhemMode, aramMode, classicMode } from "../src/lib/mode";
import type { GameMode } from "../src/lib/mode/types";
import type { Item } from "../src/lib/data-ingest/types";

const ENUM_CAP = 500; // createGamePlanSchema MAX_ENUM_SIZE: over this, enum disables
const HEALTHY_FLOOR = 50; // the ARAM cornering had 21; real ARAM is ~150-200

// Items that MUST survive the ARAM enum or the model is cornered. These are the
// exact class that broke (on-hit AD). DDragon-exact names.
const ARAM_ONHIT_CANARIES = [
  "Guinsoo's Rageblade",
  "Blade of The Ruined King",
  "Runaan's Hurricane",
  "Kraken Slayer",
  "Wit's End",
];

function eligibleNames(items: Map<number, Item>, mode: GameMode): string[] {
  // Unique names, matching the enum the feature actually builds: in ARAM a
  // standard item and its same-named variant both pass, but the enum dedupes.
  const names = new Set(
    [...items.values()]
      .filter((i) => isBuildPathEligible(i, mode))
      .map((i) => i.name)
  );
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  console.log("Loading game data (same pipeline as the app)...\n");
  const data = await fetchAndCache();

  const modes: Array<{ label: string; mode: GameMode; canaries?: string[] }> = [
    {
      label: "ARAM Mayhem",
      mode: aramMayhemMode,
      canaries: ARAM_ONHIT_CANARIES,
    },
    { label: "ARAM", mode: aramMode, canaries: ARAM_ONHIT_CANARIES },
    { label: "Classic (Summoner's Rift)", mode: classicMode },
  ];

  let failed = false;

  for (const { label, mode, canaries } of modes) {
    const names = eligibleNames(data.items, mode);
    const count = names.length;
    const enumOn = count > 0 && count <= ENUM_CAP;

    console.log(`=== ${label} ===`);
    console.log(`  eligible items: ${count}`);
    console.log(`  enum enabled (1..${ENUM_CAP}): ${enumOn}`);

    if (!enumOn) {
      console.log("  FAIL: enum would disable, name validation off");
      failed = true;
    }
    if (count < HEALTHY_FLOOR) {
      console.log(
        `  FAIL: ${count} items is below the healthy floor ${HEALTHY_FLOOR} (cornering risk)`
      );
      failed = true;
    }
    if (canaries) {
      const present = canaries.filter((c) => names.includes(c));
      const missing = canaries.filter((c) => !names.includes(c));
      console.log(
        `  on-hit canaries: ${present.length}/${canaries.length} present` +
          (missing.length ? ` (missing: ${missing.join(", ")})` : "")
      );
      if (present.length === 0) {
        console.log(
          "  FAIL: no on-hit AD items in the enum (the cornering signature)"
        );
        failed = true;
      }
    }
    console.log(
      `  sample: ${names.slice(0, 14).join(", ")}${count > 14 ? ", ..." : ""}\n`
    );
  }

  if (failed) {
    console.error("RESULT: FAIL");
    process.exit(1);
  }
  console.log("RESULT: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
