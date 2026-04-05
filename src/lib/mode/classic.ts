/**
 * Classic (Summoner's Rift) mode — items only, no augments, no balance overrides.
 *
 * Matches the "CLASSIC" game mode string from the Live Client Data API.
 */

import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { GameMode, ModeContext, PlayerModeContext } from "./types";
import { GAME_MODE_CLASSIC } from "./types";
import { filterItemsByMode, buildTeamComposition } from "./utils";

export const classicMode: GameMode = {
  id: "classic",
  displayName: "Classic",
  decisionTypes: ["item-purchase", "open-ended-coaching"],
  augmentSelectionLevels: [],

  matches(gameMode: string): boolean {
    return gameMode === GAME_MODE_CLASSIC;
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
        balanceOverrides: null, // No balance overrides on Summoner's Rift
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
      mode: classicMode,
      playerContexts,
      modeItems: filterItemsByMode(gameData.items, "standard"),
      modeAugments: new Map(),
      augmentSets: [],
      allyTeamComp: buildTeamComposition(allyPlayers),
      enemyTeamComp: buildTeamComposition(enemyPlayers),
    };
  },
};
