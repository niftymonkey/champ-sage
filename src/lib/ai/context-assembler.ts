import type { LiveGameState } from "../reactive/types";
import type { PlayerInfo } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { CoachingContext } from "./types";
import type { AramOverrides } from "../data-ingest/types";

export function assembleContext(
  gameState: LiveGameState,
  gameData: LoadedGameData
): CoachingContext | null {
  if (!gameState.activePlayer) {
    return null;
  }

  const activePlayer = gameState.activePlayer;
  const activePlayerInfo = gameState.players.find((p) => p.isActivePlayer);

  const championKey = activePlayer.championName.toLowerCase();
  const champion = gameData.champions.get(championKey);

  const abilities = champion?.abilities
    ? formatAbilities(champion.abilities)
    : `${activePlayer.championName} (no ability data available)`;

  const currentItems = activePlayerInfo
    ? activePlayerInfo.items.map((item) => ({
        name: item.name,
        description: gameData.items.get(item.id)?.description ?? "",
      }))
    : [];

  const activeTeam = activePlayerInfo?.team ?? "ORDER";

  const enemyTeam = gameState.players
    .filter((p) => p.team !== activeTeam)
    .map((p) => ({
      champion: p.championName,
      items: p.items.map((item) => ({
        name: item.name,
        description: gameData.items.get(item.id)?.description ?? "",
      })),
    }));

  const allyTeam = gameState.players
    .filter((p) => p.team === activeTeam && !p.isActivePlayer)
    .map((p) => ({
      champion: p.championName,
    }));

  const balanceOverrides = champion?.aramOverrides
    ? formatBalanceOverrides(champion.aramOverrides)
    : null;

  const statProfile = champion ? formatStatProfile(champion) : null;
  const teamAnalysis = buildTeamAnalysis(
    gameState.players,
    activeTeam,
    gameData
  );

  return {
    champion: {
      name: activePlayer.championName,
      level: activePlayer.level,
      abilities,
      statProfile,
    },
    currentItems,
    currentAugments: [],
    teamAnalysis,
    augmentSets: gameData.augmentSets,
    enemyTeam,
    allyTeam,
    gameMode: gameState.gameMode,
    lcuGameMode: gameState.lcuGameMode,
    gameTime: gameState.gameTime,
    balanceOverrides,
  };
}

function formatAbilities(
  abilities: NonNullable<import("../data-ingest/types").Champion["abilities"]>
): string {
  const parts: string[] = [];
  parts.push(
    `Passive: ${abilities.passive.name} - ${abilities.passive.description}`
  );
  for (const spell of abilities.spells) {
    parts.push(`${spell.name} - ${spell.description}`);
  }
  return parts.join("\n");
}

function formatBalanceOverrides(overrides: AramOverrides): string | null {
  const parts: string[] = [];
  if (overrides.dmgDealt !== 1) {
    parts.push(`Damage dealt: ${formatPct(overrides.dmgDealt)}`);
  }
  if (overrides.dmgTaken !== 1) {
    parts.push(`Damage taken: ${formatPct(overrides.dmgTaken)}`);
  }
  if (overrides.healing != null && overrides.healing !== 1) {
    parts.push(`Healing: ${formatPct(overrides.healing)}`);
  }
  if (overrides.shielding != null && overrides.shielding !== 1) {
    parts.push(`Shielding: ${formatPct(overrides.shielding)}`);
  }
  if (overrides.tenacity != null && overrides.tenacity !== 1) {
    parts.push(`Tenacity: ${formatPct(overrides.tenacity)}`);
  }
  if (overrides.abilityHaste != null && overrides.abilityHaste !== 0) {
    parts.push(`Ability Haste: +${overrides.abilityHaste}`);
  }
  if (parts.length === 0) return null;
  return parts.join(", ");
}

function formatPct(value: number): string {
  const pct = Math.round((value - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Build a compact stat profile string for a champion.
 *
 * Includes range type, DDragon tags, and key base stats with growth rates.
 * The model uses this to reason about build viability — e.g., a melee Fighter
 * with high HP/level can pivot to tank, while a ranged Mage/Support cannot.
 *
 * Deliberately does NOT prescribe a role. The model derives the optimal
 * playstyle from this profile + current items + augments + team comp.
 */
function formatStatProfile(
  champion: import("../data-ingest/types").Champion
): string {
  const s = champion.stats;
  const rangeType =
    s.attackrange <= 300 ? "Melee" : `Ranged (${s.attackrange})`;

  const parts = [
    rangeType,
    champion.tags.join(", "),
    `HP: ${s.hp} (+${s.hpperlevel}/lvl)`,
    `AD: ${s.attackdamage} (+${s.attackdamageperlevel}/lvl)`,
    `AS: ${s.attackspeed} (+${s.attackspeedperlevel}%/lvl)`,
    `Armor: ${s.armor} (+${s.armorperlevel}/lvl)`,
    `MR: ${s.spellblock} (+${s.spellblockperlevel}/lvl)`,
    champion.partype || "No resource",
  ];

  return parts.join(" | ");
}

/** Tags that indicate AD-based damage dealers */
const AD_TAGS = new Set(["Marksman", "Assassin", "Fighter"]);
/** Tags that indicate AP-based damage dealers */
const AP_TAGS = new Set(["Mage"]);
/** All recognized role tags */
const ALL_ROLES = [
  "Fighter",
  "Tank",
  "Mage",
  "Assassin",
  "Marksman",
  "Support",
];

/**
 * Build a team composition analysis from champion tags.
 *
 * Provides:
 * - Your team's role breakdown (tag counts + missing roles)
 * - Enemy team's damage profile (AD vs AP threat count)
 *
 * Returns null if no champion data is available for any team member.
 */
function buildTeamAnalysis(
  players: PlayerInfo[],
  activeTeam: string,
  gameData: LoadedGameData
): string | null {
  // Resolve tags for all players
  const alliedPlayers = players.filter((p) => p.team === activeTeam);
  const enemyPlayers = players.filter((p) => p.team !== activeTeam);

  const allyTags = resolveTeamTags(alliedPlayers, gameData);
  const enemyTags = resolveTeamTags(enemyPlayers, gameData);

  // If we couldn't resolve any tags, skip analysis
  if (allyTags.length === 0 && enemyTags.length === 0) return null;

  const parts: string[] = [];

  // Ally role breakdown — show tag counts and notable gaps
  if (allyTags.length > 0) {
    const roleCounts = countRoles(allyTags);
    const roleList = ALL_ROLES.filter((r) => roleCounts.get(r))
      .map((r) => `${roleCounts.get(r)} ${r}`)
      .join(", ");
    const missingRoles = ALL_ROLES.filter((r) => !roleCounts.has(r));

    let line = `Your team roles: ${roleList}`;
    if (missingRoles.length > 0 && missingRoles.length <= 3) {
      line += ` — no ${missingRoles.join(", ")}`;
    }
    parts.push(line);
  }

  // Enemy damage profile — classify as skewed or mixed
  // "Heavily AD" / "Heavily AP" = stack the corresponding resistance
  // "Mixed" = don't prioritize one resistance type
  if (enemyTags.length > 0) {
    let adCount = 0;
    let apCount = 0;
    for (const tags of enemyTags) {
      const isAD = tags.some((t) => AD_TAGS.has(t));
      const isAP = tags.some((t) => AP_TAGS.has(t));
      if (isAD) adCount++;
      if (isAP) apCount++;
    }

    const total = enemyTags.length;
    if (adCount > 0 || apCount > 0) {
      let damageProfile: string;
      if (apCount === 0) {
        damageProfile = `Enemy damage: all AD (${adCount}/${total} — stack armor)`;
      } else if (adCount === 0) {
        damageProfile = `Enemy damage: all AP (${apCount}/${total} — stack magic resist)`;
      } else if (adCount >= total * 0.7) {
        damageProfile = `Enemy damage: heavily AD (${adCount} AD, ${apCount} AP — favor armor)`;
      } else if (apCount >= total * 0.7) {
        damageProfile = `Enemy damage: heavily AP (${apCount} AP, ${adCount} AD — favor magic resist)`;
      } else {
        damageProfile = `Enemy damage: mixed (${adCount} AD, ${apCount} AP)`;
      }
      parts.push(damageProfile);
    }
  }

  return parts.length > 0 ? parts.join(". ") + "." : null;
}

/** Resolve DDragon tags for each player in a team */
function resolveTeamTags(
  players: PlayerInfo[],
  gameData: LoadedGameData
): string[][] {
  const result: string[][] = [];
  for (const player of players) {
    const champion = gameData.champions.get(player.championName.toLowerCase());
    if (champion) {
      result.push(champion.tags);
    }
  }
  return result;
}

/** Count occurrences of each role tag across a team */
function countRoles(teamTags: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tags of teamTags) {
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}
