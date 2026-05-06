import type { GameflowPhase } from "../lib/reactive/types";

/**
 * The five top-level desktop views the v16 redesign defines. The renderer
 * shows exactly one at a time; everything else (overlays, dialogs) sits
 * outside this state machine.
 */
export type Surface =
  | "idle"
  | "champ-select"
  | "in-game"
  | "post-game"
  | "settings";

export const SURFACES: readonly Surface[] = [
  "idle",
  "champ-select",
  "in-game",
  "post-game",
  "settings",
];

interface ResolveSurfaceInput {
  /** LCU gameflow phase, or null if the LCU has not connected yet. */
  phase: GameflowPhase | null;
  /** True when the Live Client poll has yielded an active player. */
  hasActivePlayer: boolean;
  /**
   * User-driven override (clicking a nav tab). When present it wins over
   * the phase-derived default. Reset to null when the phase next changes
   * if you want auto-routing to resume.
   */
  manualOverride: Surface | null;
  /**
   * True once the renderer has observed at least one in-game-ish phase
   * (ChampSelect, GameStart, InProgress) since launch. Post-game routing
   * is gated on this so a fresh app launch into a stale `EndOfGame` phase
   * (the LCU still reports the last match's wind-down) doesn't drop the
   * user on History when they expect Home.
   */
  hasSeenInGamePhase: boolean;
}

/**
 * Map the current LCU phase + simulator state to the surface the renderer
 * should show. A manual override (nav-tab click) always wins so the user
 * can read SETTINGS or HOME mid-game without being yanked back.
 *
 * The mapping intentionally collapses phases that share a surface:
 *   None / Lobby / Matchmaking / ReadyCheck / TerminatedInError -> idle
 *   ChampSelect                                                  -> champ-select
 *   GameStart / InProgress                                       -> in-game
 *   PreEndOfGame / EndOfGame / WaitingForStats                   -> post-game
 *     (only after we've seen an in-game-ish phase this session;
 *      otherwise treated as idle so a fresh launch lands at Home)
 *
 * The simulator can inject an active player without emitting LCU phase
 * events, so a non-null `hasActivePlayer` short-circuits to in-game.
 */
export function resolveSurface(input: ResolveSurfaceInput): Surface {
  if (input.manualOverride) return input.manualOverride;

  switch (input.phase) {
    case "ChampSelect":
      return "champ-select";
    case "GameStart":
    case "InProgress":
      return "in-game";
    case "PreEndOfGame":
    case "EndOfGame":
    case "WaitingForStats":
      return input.hasSeenInGamePhase ? "post-game" : "idle";
    default:
      // None, Lobby, Matchmaking, ReadyCheck, TerminatedInError, or null.
      // Fall through to the simulator escape hatch.
      break;
  }

  if (input.hasActivePlayer) return "in-game";
  return "idle";
}
