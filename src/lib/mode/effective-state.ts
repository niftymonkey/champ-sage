import type { GameState, PlayerInfo } from "../game-state/types";
import type { EffectiveGameState, EffectivePlayer, ModeContext } from "./types";

export function buildEffectiveGameState(
  gameState: GameState,
  modeContext: ModeContext | null
): EffectiveGameState {
  const activeTeam = gameState.players.find((p) => p.isActivePlayer)?.team;
  const allies: EffectivePlayer[] = [];
  const enemies: EffectivePlayer[] = [];
  let activePlayer: EffectivePlayer | null = null;

  for (const player of gameState.players) {
    const effective = buildEffectivePlayer(player, gameState, modeContext);

    if (player.isActivePlayer && gameState.activePlayer) {
      activePlayer = effective;
    }

    if (player.team === activeTeam) {
      allies.push(effective);
    } else {
      enemies.push(effective);
    }
  }

  return {
    raw: gameState,
    modeContext,
    status: gameState.status,
    gameMode: gameState.gameMode,
    gameTime: gameState.gameTime,
    activePlayer,
    allies,
    enemies,
  };
}

function buildEffectivePlayer(
  player: PlayerInfo,
  gameState: GameState,
  modeContext: ModeContext | null
): EffectivePlayer {
  const playerCtx = modeContext?.playerContexts.get(player.riotIdGameName);
  const isActive = player.isActivePlayer;

  return {
    championName: player.championName,
    level: player.level,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    items: player.items,
    summonerSpells: player.summonerSpells,
    riotIdGameName: player.riotIdGameName,
    position: player.position,
    isActivePlayer: isActive,
    tags: playerCtx?.tags ?? [],
    balanceOverrides: playerCtx?.balanceOverrides ?? null,
    ...(isActive && gameState.activePlayer
      ? {
          currentGold: gameState.activePlayer.currentGold,
          runes: gameState.activePlayer.runes,
          stats: gameState.activePlayer.stats,
          selectedAugments: playerCtx?.selectedAugments,
          setProgress: playerCtx?.setProgress,
        }
      : {}),
  };
}
