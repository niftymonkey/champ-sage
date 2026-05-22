/**
 * The outcome of a League match as the app models it.
 *
 * `remake` is a third state, distinct from a loss. When a player fails
 * to connect, their team can vote to void the game at roughly the
 * 3-minute mark. The LCU reports this via `gameEndedInEarlySurrender`
 * (a per-participant field in match history, a top-level field in the
 * end-of-game stats block). A remade game carries no win/loss record
 * and awards no rewards, so it must never be folded into win/loss
 * display or into win/loss/KDA aggregates.
 *
 * Note: a remake is NOT the same as a normal surrender. A team that
 * forfeits at 15:00+ produces `gameEndedInSurrender` and still records
 * a real win or loss, which stays `win` / `loss` here.
 */
export type GameResult = "win" | "loss" | "remake";

/**
 * Derive the {@link GameResult} from the two LCU signals.
 *
 * `gameEndedInEarlySurrender` takes precedence: a remade game has no
 * winning team, so its `win` flag is meaningless (false for everyone).
 */
export function deriveGameResult(
  win: boolean,
  gameEndedInEarlySurrender: boolean
): GameResult {
  if (gameEndedInEarlySurrender) return "remake";
  return win ? "win" : "loss";
}

/**
 * Capitalised display label for a {@link GameResult}. Callers adjust
 * casing for their surface (the post-game eyebrow uppercases it).
 */
export function resultLabel(result: GameResult): string {
  switch (result) {
    case "win":
      return "Win";
    case "loss":
      return "Loss";
    case "remake":
      return "Remake";
  }
}
