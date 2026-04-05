/**
 * Convert coaching eval fixtures from the old CoachingContext format to a
 * raw format consumable by buildGameSystemPrompt(), takeGameSnapshot(), and
 * createConversationSession().
 *
 * Reads from:  fixtures/coaching-sessions/*.json
 * Writes to:   fixtures/coaching-sessions-v2/*.json
 *
 * Usage:
 *   pnpm convert-fixtures
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchAndCache } from "../src/lib/data-ingest/index";
import type {
  Champion,
  Item,
  ChampionStats,
} from "../src/lib/data-ingest/types";

// ---------------------------------------------------------------------------
// Old fixture shape
// ---------------------------------------------------------------------------

interface OldFixture {
  label: string;
  index: number;
  timestamp: string;
  model: string;
  context: {
    champion: {
      name: string;
      level: number;
      abilities: string;
      statProfile: string | null;
    };
    currentItems: Array<{ name: string; description: string }>;
    currentGold: number;
    kda: { kills: number; deaths: number; assists: number };
    currentAugments: Array<{
      name: string;
      description: string;
      sets?: string[];
    }>;
    enemyTeam: Array<{
      champion: string;
      items: Array<{ name: string; description: string }>;
    }>;
    allyTeam: Array<{ champion: string }>;
    teamAnalysis: string | null;
    augmentSets: Array<{
      name: string;
      bonuses: Array<{ threshold: number; description: string }>;
    }>;
    gameMode: string;
    lcuGameMode: string;
    gameTime: number;
    balanceOverrides: string | null;
  };
  query: {
    question: string;
    history?: Array<{ question: string; answer: string }>;
    augmentOptions?: Array<{
      name: string;
      description: string;
      tier: string;
      sets?: string[];
    }>;
  };
  response: {
    answer: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  } | null;
  error: string | null;
  expectedReferences?: string[];
  category?: string;
}

// ---------------------------------------------------------------------------
// New fixture shape
// ---------------------------------------------------------------------------

interface ActivePlayerStats {
  abilityPower: number;
  armor: number;
  attackDamage: number;
  attackSpeed: number;
  abilityHaste: number;
  critChance: number;
  magicResist: number;
  moveSpeed: number;
  maxHealth: number;
  currentHealth: number;
}

interface PlayerEntry {
  championName: string;
  team: "ORDER" | "CHAOS";
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  items: Array<{ id: number; name: string }>;
  summonerSpells: [string, string];
  riotIdGameName: string;
  position: string;
  isActivePlayer: boolean;
}

interface MultiTurnFixture {
  label: string;
  index: number;
  timestamp: string;
  model: string;
  category: string;

  gameState: {
    status: "connected";
    activePlayer: {
      championName: string;
      level: number;
      currentGold: number;
      runes: {
        keystone: string;
        primaryTree: string;
        secondaryTree: string;
      };
      stats: ActivePlayerStats;
    };
    players: PlayerEntry[];
    gameMode: string;
    gameTime: number;
  };

  gameModeId: "aram-mayhem" | "aram" | "classic";
  chosenAugments: string[];

  query: {
    question: string;
    history?: Array<{ question: string; answer: string }>;
    augmentOptions?: Array<{
      name: string;
      description: string;
      tier: string;
      sets?: string[];
    }>;
  };

  response: {
    answer: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  } | null;
  error: string | null;
  expectedReferences?: string[];

  scorerContext: {
    items: string[];
    gold: number;
    champion: string;
    gameTime: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "..");
const INPUT_DIR = join(ROOT, "fixtures", "coaching-sessions");
const OUTPUT_DIR = join(ROOT, "fixtures", "coaching-sessions-v2");

/** Riot's per-level scaling factor */
function levelScaleFactor(level: number): number {
  return (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

/** Compute approximate base+level stats for a champion */
function computeBaseStats(
  stats: ChampionStats,
  level: number
): ActivePlayerStats {
  const scale = levelScaleFactor(level);
  return {
    attackDamage: Math.round(
      stats.attackdamage + stats.attackdamageperlevel * scale
    ),
    abilityPower: 0, // base AP is always 0
    armor: Math.round(stats.armor + stats.armorperlevel * scale),
    magicResist: Math.round(
      stats.spellblock + stats.spellblockperlevel * scale
    ),
    maxHealth: Math.round(stats.hp + stats.hpperlevel * scale),
    currentHealth: Math.round(stats.hp + stats.hpperlevel * scale),
    moveSpeed: stats.movespeed,
    attackSpeed:
      Math.round(
        stats.attackspeed *
          (1 + (stats.attackspeedperlevel * scale) / 100) *
          1000
      ) / 1000,
    abilityHaste: 0,
    critChance: 0,
  };
}

/** Build a reverse lookup: lowercase item name -> Item */
function buildItemNameIndex(items: Map<number, Item>): Map<string, Item> {
  const index = new Map<string, Item>();
  for (const item of items.values()) {
    index.set(item.name.toLowerCase(), item);
  }
  return index;
}

/** Look up an item ID by name (case-insensitive), returning 0 if not found */
function resolveItemId(name: string, itemNameIndex: Map<string, Item>): number {
  return itemNameIndex.get(name.toLowerCase())?.id ?? 0;
}

/** Map gameMode string to gameModeId */
function resolveGameModeId(
  gameMode: string
): "aram-mayhem" | "aram" | "classic" {
  switch (gameMode.toUpperCase()) {
    case "KIWI":
      return "aram-mayhem";
    case "ARAM":
      return "aram";
    default:
      return "classic";
  }
}

/** Format seconds as "M:SS" */
function formatGameTime(seconds: number): string {
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function convertFixture(
  old: OldFixture,
  champions: Map<string, Champion>,
  itemNameIndex: Map<string, Item>
): MultiTurnFixture {
  const ctx = old.context;

  // Champion lookup
  const champion = champions.get(ctx.champion.name.toLowerCase());
  if (!champion) {
    console.warn(
      `  WARN: Champion "${ctx.champion.name}" not found in game data — using placeholder stats`
    );
  }

  const stats = champion
    ? computeBaseStats(champion.stats, ctx.champion.level)
    : {
        attackDamage: 0,
        abilityPower: 0,
        armor: 0,
        magicResist: 0,
        maxHealth: 0,
        currentHealth: 0,
        moveSpeed: 0,
        attackSpeed: 0,
        abilityHaste: 0,
        critChance: 0,
      };

  // Player items
  const playerItems = ctx.currentItems.map((item) => ({
    id: resolveItemId(item.name, itemNameIndex),
    name: item.name,
  }));

  // Build players list
  const players: PlayerEntry[] = [];

  // Active player (ORDER team)
  players.push({
    championName: ctx.champion.name,
    team: "ORDER",
    level: ctx.champion.level,
    kills: ctx.kda.kills,
    deaths: ctx.kda.deaths,
    assists: ctx.kda.assists,
    items: playerItems,
    summonerSpells: ["Flash", "Mark"],
    riotIdGameName: "Player1",
    position: "",
    isActivePlayer: true,
  });

  // Allies (ORDER team)
  ctx.allyTeam.forEach((ally, i) => {
    players.push({
      championName: ally.champion,
      team: "ORDER",
      level: ctx.champion.level, // approximate: use active player level
      kills: 0,
      deaths: 0,
      assists: 0,
      items: [],
      summonerSpells: ["Flash", "Mark"],
      riotIdGameName: `Ally${i + 1}`,
      position: "",
      isActivePlayer: false,
    });
  });

  // Enemies (CHAOS team)
  ctx.enemyTeam.forEach((enemy, i) => {
    const enemyItems = enemy.items.map((item) => ({
      id: resolveItemId(item.name, itemNameIndex),
      name: item.name,
    }));
    players.push({
      championName: enemy.champion,
      team: "CHAOS",
      level: ctx.champion.level, // approximate: use active player level
      kills: 0,
      deaths: 0,
      assists: 0,
      items: enemyItems,
      summonerSpells: ["Flash", "Mark"],
      riotIdGameName: `Enemy${i + 1}`,
      position: "",
      isActivePlayer: false,
    });
  });

  return {
    label: old.label,
    index: old.index,
    timestamp: old.timestamp,
    model: old.model,
    category: old.category ?? "common",

    gameState: {
      status: "connected",
      activePlayer: {
        championName: ctx.champion.name,
        level: ctx.champion.level,
        currentGold: ctx.currentGold,
        runes: {
          keystone: "Unknown",
          primaryTree: "Unknown",
          secondaryTree: "Unknown",
        },
        stats,
      },
      players,
      gameMode: ctx.gameMode,
      gameTime: ctx.gameTime,
    },

    gameModeId: resolveGameModeId(ctx.gameMode),
    chosenAugments: ctx.currentAugments.map((a) => a.name),

    query: old.query,
    response: old.response,
    error: old.error,
    expectedReferences: old.expectedReferences,

    scorerContext: {
      items: ctx.currentItems.map((i) => i.name),
      gold: ctx.currentGold,
      champion: ctx.champion.name,
      gameTime: formatGameTime(ctx.gameTime),
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Loading game data...");
  const gameData = await fetchAndCache();
  console.log(
    `Loaded ${gameData.champions.size} champions, ${gameData.items.size} items\n`
  );

  const itemNameIndex = buildItemNameIndex(gameData.items);

  // Read input fixtures
  const files = readdirSync(INPUT_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`No fixture files found in ${INPUT_DIR}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalConverted = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const inputPath = join(INPUT_DIR, file);
    const raw = readFileSync(inputPath, "utf-8");
    const oldFixtures: OldFixture[] = JSON.parse(raw);

    console.log(`Converting ${file} (${oldFixtures.length} entries)...`);

    const newFixtures: MultiTurnFixture[] = [];
    for (const old of oldFixtures) {
      const champion = gameData.champions.get(
        old.context.champion.name.toLowerCase()
      );
      if (!champion) totalWarnings++;

      newFixtures.push(convertFixture(old, gameData.champions, itemNameIndex));
    }

    const outputPath = join(OUTPUT_DIR, file);
    writeFileSync(outputPath, JSON.stringify(newFixtures, null, 2));
    console.log(`  -> ${outputPath} (${newFixtures.length} entries)\n`);
    totalConverted += newFixtures.length;
  }

  console.log(
    `Done. Converted ${totalConverted} fixtures across ${files.length} files.`
  );
  if (totalWarnings > 0) {
    console.log(
      `${totalWarnings} warning(s) — some champions were not found in game data.`
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
