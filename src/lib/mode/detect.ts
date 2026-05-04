import type { GameMode, ModeRegistry } from "./types";
import { GAME_MODE_ARAM, GAME_MODE_ARENA, GAME_MODE_CLASSIC } from "./types";

/**
 * Map id (from the Live Client `gameData.mapNumber` block) to the equivalent
 * mode string. Used only as the deepest mode-detection fallback for Practice
 * Tool sessions where both `gameMode` and the LCU mode report `PRACTICETOOL`.
 *
 * Mayhem (KIWI) shares the Howling Abyss map (12) with regular ARAM but is
 * queue-only and cannot be opened in Practice Tool, so map 12 resolves to
 * ARAM here without ambiguity.
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
  const live = registry.detect(liveGameMode);
  if (live) return live;
  if (lcuGameMode) {
    const fromLcu = registry.detect(lcuGameMode);
    if (fromLcu) return fromLcu;
  }
  const mapMode = MAP_TO_MODE[mapNumber];
  if (mapMode) return registry.detect(mapMode);
  return null;
}
