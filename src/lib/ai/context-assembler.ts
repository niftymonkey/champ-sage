import type { LiveGameState } from "../reactive/types";
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
    ? activePlayerInfo.items.map((item) => item.name)
    : [];

  const activeTeam = activePlayerInfo?.team ?? "ORDER";

  const enemyTeam = gameState.players
    .filter((p) => p.team !== activeTeam)
    .map((p) => ({
      champion: p.championName,
      items: p.items.map((item) => item.name),
    }));

  const allyTeam = gameState.players
    .filter((p) => p.team === activeTeam && !p.isActivePlayer)
    .map((p) => ({
      champion: p.championName,
    }));

  const balanceOverrides = champion?.aramOverrides
    ? formatBalanceOverrides(champion.aramOverrides)
    : null;

  return {
    champion: {
      name: activePlayer.championName,
      level: activePlayer.level,
      abilities,
    },
    currentItems,
    currentAugments: [],
    enemyTeam,
    allyTeam,
    gameMode: gameState.gameMode,
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
