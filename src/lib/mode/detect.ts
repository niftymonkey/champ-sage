import type { GameMode, ModeRegistry } from "./types";
import { GAME_MODE_ARAM, GAME_MODE_ARENA, GAME_MODE_CLASSIC } from "./types";

/**
 * Map id (from the Live Client `gameData.mapNumber` block) to the equivalent
 * mode string. Used only as the deepest mode-detection fallback for Practice
 * Tool sessions where both `gameMode` and the LCU mode report `PRACTICETOOL`.
 *
 * Map 12 (renamed "Random Map" upstream in 16.15.1) hosts regular ARAM, Mayhem
 * (`KIWI`) and Mayhem Classic-ish (`KIWI_JADE`), so the map id does NOT
 * identify the mode. It resolves to ARAM here only because this table is
 * reachable exclusively from a Practice Tool session, and the queue-only modes
 * cannot be opened in Practice Tool. Consulting it for a queued game is what
 * made KIWI_JADE masquerade as ARAM; see `describeModeDetection`.
 */
const MAP_TO_MODE: Record<number, string> = {
  11: GAME_MODE_CLASSIC,
  12: GAME_MODE_ARAM,
  30: GAME_MODE_ARENA,
};

/**
 * Resolve the active mode for the current game session.
 *
 * The Live Client Data API's `gameMode` is normally authoritative, but it
 * returns the literal string `PRACTICETOOL` for any Practice Tool session
 * regardless of the map the player chose, which never matches a registered
 * mode. The LCU's `/lol-gameflow/v1/session` queue block ALSO echoes
 * `PRACTICETOOL` for those sessions (verified empirically; the queue field
 * is not actually populated with the underlying mode), so we fall through
 * one more level to the Live Client `mapNumber` and translate that to a
 * mode string via `MAP_TO_MODE`.
 *
 * Resolution order:
 *   1. Live Client gameMode (authoritative for queued play)
 *   2. LCU gameMode (occasionally more specific; rarely useful in practice)
 *   3. Live Client mapNumber translated through MAP_TO_MODE (Practice Tool)
 *
 * Returns null only when none of those produce a registered match.
 */
export function detectMode(
  registry: ModeRegistry,
  liveGameMode: string,
  lcuGameMode: string,
  mapNumber: number = 0
): GameMode | null {
  return describeModeDetection(registry, liveGameMode, lcuGameMode, mapNumber)
    .mode;
}

/** The Live Client and LCU both report this for any Practice Tool session. */
const PRACTICE_TOOL = "PRACTICETOOL";

/**
 * The outcome of mode detection, including whether the session named a game
 * mode we have never heard of.
 *
 * `unrecognizedGameMode` is the drift signal: a non-empty mode string that
 * matched no registered mode and is not the benign `PRACTICETOOL` placeholder.
 * It means Riot shipped a mode we do not model, which is a state the app must
 * announce rather than paper over. Callers use it to log once per game and to
 * tell the player their coaching is off for this mode.
 */
export interface ModeDetection {
  mode: GameMode | null;
  unrecognizedGameMode: string | null;
}

/**
 * Resolve the active mode and report whether the session named an unknown one.
 *
 * See `detectMode` for the resolution order. The `mapNumber` step is gated on
 * the session actually being Practice Tool, which is the only case it was ever
 * meant to serve: applying it to any unmatched mode string is how KIWI_JADE
 * ("ARAM: Mayhem Classic-ish", map 12, legacy shop and legacy ability kits)
 * silently resolved to plain ARAM for a whole patch.
 */
export function describeModeDetection(
  registry: ModeRegistry,
  liveGameMode: string,
  lcuGameMode: string,
  mapNumber: number = 0
): ModeDetection {
  const live = registry.detect(liveGameMode);
  if (live) return { mode: live, unrecognizedGameMode: null };

  if (lcuGameMode) {
    const fromLcu = registry.detect(lcuGameMode);
    if (fromLcu) return { mode: fromLcu, unrecognizedGameMode: null };
  }

  const isPracticeTool =
    liveGameMode === PRACTICE_TOOL &&
    (lcuGameMode === PRACTICE_TOOL || lcuGameMode === "");
  if (isPracticeTool) {
    const mapMode = MAP_TO_MODE[mapNumber];
    const fromMap = mapMode ? registry.detect(mapMode) : null;
    return { mode: fromMap, unrecognizedGameMode: null };
  }

  return {
    mode: null,
    unrecognizedGameMode: namedUnknown(liveGameMode, lcuGameMode),
  };
}

/**
 * The most specific mode string worth reporting as unknown. Empty strings mean
 * the game has not reported yet, and `PRACTICETOOL` is an expected placeholder;
 * reporting either as drift would train the reader to ignore the signal.
 */
function namedUnknown(
  liveGameMode: string,
  lcuGameMode: string
): string | null {
  for (const candidate of [liveGameMode, lcuGameMode]) {
    if (candidate && candidate !== PRACTICE_TOOL) return candidate;
  }
  return null;
}
