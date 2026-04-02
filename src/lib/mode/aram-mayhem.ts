import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type {
  GameMode,
  ModeContext,
  PlayerModeContext,
  TeamComposition,
} from "./types";
import { GAME_MODE_MAYHEM, GAME_MODE_ARAM } from "./types";
import { filterItemsByMode, filterAugmentsByMode } from "./utils";

export const aramMayhemMode: GameMode = {
  id: "aram-mayhem",
  displayName: "ARAM Mayhem",
  decisionTypes: ["augment-selection", "item-purchase", "open-ended-coaching"],
  augmentSelectionLevels: [1, 7, 11, 15],

  matches(gameMode: string): boolean {
    return gameMode === GAME_MODE_MAYHEM || gameMode === GAME_MODE_ARAM;
  },

  buildContext(gameState: GameState, gameData: LoadedGameData): ModeContext {
    const activePlayer = gameState.players.find((p) => p.isActivePlayer);
    // Default to ORDER if no active player (spectator/loading edge case)
    const activeTeam = activePlayer?.team ?? "ORDER";

    const playerContexts = new Map<string, PlayerModeContext>();
    const allyPlayers: PlayerModeContext[] = [];
    const enemyPlayers: PlayerModeContext[] = [];

    for (const player of gameState.players) {
      const champion = gameData.champions.get(
        player.championName.toLowerCase()
      );

      const ctx: PlayerModeContext = {
        championName: player.championName,
        team: player.team,
        tags: champion?.tags ?? [],
        balanceOverrides: champion?.aramOverrides ?? null,
        selectedAugments: [],
        setProgress: [],
      };

      playerContexts.set(player.riotIdGameName, ctx);

      if (player.team === activeTeam) {
        allyPlayers.push(ctx);
      } else {
        enemyPlayers.push(ctx);
      }
    }

    return {
      mode: aramMayhemMode,
      playerContexts,
      modeItems: filterItemsByMode(gameData.items, "aram"),
      modeAugments: filterAugmentsByMode(gameData.augments, "mayhem"),
      augmentSets: gameData.augmentSets,
      allyTeamComp: buildTeamComposition(allyPlayers),
      enemyTeamComp: buildTeamComposition(enemyPlayers),
    };
  },
};

function buildTeamComposition(players: PlayerModeContext[]): TeamComposition {
  const classCounts: Record<string, number> = {};
  for (const player of players) {
    for (const tag of player.tags) {
      classCounts[tag] = (classCounts[tag] ?? 0) + 1;
    }
  }
  return { players, classCounts };
}
