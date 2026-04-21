import type { GameMode } from "../mode/types";
import type { LoadedGameData } from "../data-ingest";
import type { GameState } from "../game-state/types";
import { buildBaseContext } from "./base-context";
import { buildFeatureRules } from "./feature-rules";

/**
 * Build a comprehensive system prompt for a multi-turn game session.
 *
 * Composes feature-agnostic base context (coaching persona, game state,
 * champion data, roster) with the current feature-rule block (item-rec,
 * augment-fit, etc.). Phase 3 of #108 dismantles this by moving feature
 * rules inside each feature's task prompt; this helper remains as a
 * compatibility shim for callers that still want the combined string.
 */
export function buildGameSystemPrompt(
  mode: GameMode,
  gameData: LoadedGameData,
  gameState: GameState
): string {
  const baseContext = buildBaseContext({ mode, gameData, gameState });
  const featureRules = buildFeatureRules(mode);
  return featureRules.length > 0
    ? `${baseContext}\n\n${featureRules}`
    : baseContext;
}
