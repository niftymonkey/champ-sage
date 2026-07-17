/**
 * Render the champion-specific portion of the coaching system prompt.
 *
 * Loads the real data pipeline, resolves the same per-match extras the app
 * resolves (lazily-fetched abilities, bundled meta builds), synthesizes a
 * minimal in-game state for a champion, and prints what `buildBaseContext`
 * produces. Useful for eyeballing exactly how much a champion contributes to
 * an augment-fit (or any other feature) prompt.
 *
 * Meta builds need reproducing by hand here: they reach the app through Vite's
 * `import.meta.glob`, a build-time transform with no equivalent under tsx, so
 * we read the same JSON files from disk and inject them as the override the
 * loader accepts. Abilities need no such help; they arrive with the ingest.
 *
 * Usage:
 *   pnpm dump-champion-prompt Jhin Nasus Lux
 *   pnpm dump-champion-prompt            # three arbitrary champions
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAndCache } from "../src/lib/data-ingest/index";
import { loadMetaBuilds } from "../src/lib/data-ingest/meta-builds";
import { buildBaseContext } from "../src/lib/ai/base-context";
import { aramMayhemMode } from "../src/lib/mode/aram-mayhem";
import type { GameState } from "../src/lib/game-state/types";

const META_BUILD_DIR = join(
  import.meta.dirname,
  "..",
  "src",
  "data",
  "meta-builds"
);

/**
 * Stand in for Vite's `import.meta.glob` map by reading the bundled meta-build
 * JSON off disk, so the loader sees the same files the renderer bundles.
 */
function metaBuildGlobFromDisk(): Record<string, () => Promise<unknown>> {
  const files = ["aram", "ranked-solo", "arena"];
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const name of files) {
    modules[`../../data/meta-builds/${name}.json`] = async () => ({
      default: JSON.parse(
        readFileSync(join(META_BUILD_DIR, `${name}.json`), "utf8")
      ),
    });
  }
  return modules;
}

function stateForChampion(championName: string): GameState {
  return {
    status: "connected",
    activePlayer: {
      championName,
      level: 11,
      currentGold: 1450,
      runes: {
        keystone: "Conqueror",
        primaryTree: "Precision",
        secondaryTree: "Resolve",
      },
      stats: {
        abilityPower: 0,
        armor: 60,
        attackDamage: 140,
        attackSpeed: 1.1,
        abilityHaste: 20,
        critChance: 0,
        magicResist: 40,
        moveSpeed: 340,
        maxHealth: 1800,
        currentHealth: 1800,
      },
    },
    players: [],
    gameMode: "KIWI",
    gameTime: 900,
  };
}

async function main() {
  const requested = process.argv.slice(2);
  const data = await fetchAndCache();
  data.metaBuilds = await loadMetaBuilds(metaBuildGlobFromDisk());

  const names =
    requested.length > 0
      ? requested
      : [...data.champions.values()].slice(0, 3).map((c) => c.name);

  for (const name of names) {
    const context = buildBaseContext({
      mode: aramMayhemMode,
      gameData: data,
      gameState: stateForChampion(name),
    });
    console.log(`\n\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}\n`);
    console.log(context);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
