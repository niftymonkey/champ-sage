/**
 * Pick the slice of decision records belonging to the most recent
 * game whose takeaway has been written. Used by the post-game surface
 * to render a fully-formed last-game view at all times — even
 * immediately after a game ends, while the new takeaway's LLM call is
 * still in flight, the surface keeps showing the previous game in
 * full instead of flickering through partial state.
 */

import type { DecisionRecord } from "./types";

export function mostRecentCompletedGameSlice(
  records: readonly DecisionRecord[]
): DecisionRecord[] {
  // Find the takeaway with the highest sentAt; that game is "most
  // recently completed." Then return every record sharing its gameId.
  let chosen: { gameId: string; sentAt: number } | null = null;
  for (const r of records) {
    if (r.source !== "takeaway") continue;
    if (chosen === null || r.sentAt > chosen.sentAt) {
      chosen = { gameId: r.gameId, sentAt: r.sentAt };
    }
  }
  if (chosen === null) return [];
  return records.filter((r) => r.gameId === chosen.gameId);
}
