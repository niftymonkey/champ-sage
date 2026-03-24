import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { Augment, Item } from "../data-ingest/types";
import type {
  GameMode,
  ModeContext,
  PlayerModeContext,
  TeamComposition,
} from "./types";

export const aramMayhemMode: GameMode = {
  id: "aram-mayhem",
  displayName: "ARAM Mayhem",
  decisionTypes: ["augment-selection", "item-purchase", "open-ended-coaching"],
  augmentSelectionLevels: [1, 7, 11, 15],

  matches(gameMode: string): boolean {
    return gameMode === "ARAM" || gameMode === "KIWI";
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

function filterItemsByMode(
  items: Map<number, Item>,
  mode: string
): Map<number, Item> {
  const filtered = new Map<number, Item>();
  for (const [id, item] of items) {
    if (item.mode === mode) filtered.set(id, item);
  }
  return filtered;
}

function filterAugmentsByMode(
  augments: Map<string, Augment>,
  mode: string
): Map<string, Augment> {
  const filtered = new Map<string, Augment>();
  for (const [key, augment] of augments) {
    if (augment.mode === mode) filtered.set(key, augment);
  }
  return filtered;
}

function buildTeamComposition(players: PlayerModeContext[]): TeamComposition {
  const classCounts: Record<string, number> = {};
  for (const player of players) {
    for (const tag of player.tags) {
      classCounts[tag] = (classCounts[tag] ?? 0) + 1;
    }
  }
  return { players, classCounts };
}
