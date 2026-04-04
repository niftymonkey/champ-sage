/**
 * Straight ARAM mode — no augments, no sets, but has balance overrides.
 *
 * Matches the "ARAM" game mode string from the Live Client Data API.
 * Distinct from ARAM Mayhem (KIWI) which adds augments and sets.
 */

import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type {
  GameMode,
  ModeContext,
  PlayerModeContext,
  TeamComposition,
} from "./types";
import { GAME_MODE_ARAM } from "./types";
import { filterItemsByMode } from "./utils";

export const aramMode: GameMode = {
  id: "aram",
  displayName: "ARAM",
  decisionTypes: ["item-purchase", "open-ended-coaching"],
  augmentSelectionLevels: [],

  matches(gameMode: string): boolean {
    return gameMode === GAME_MODE_ARAM;
  },

  buildContext(gameState: GameState, gameData: LoadedGameData): ModeContext {
    const activePlayer = gameState.players.find((p) => p.isActivePlayer);
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
      mode: aramMode,
      playerContexts,
      modeItems: filterItemsByMode(gameData.items, "aram"),
      modeAugments: new Map(), // No augments in straight ARAM
      augmentSets: [], // No sets in straight ARAM
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
