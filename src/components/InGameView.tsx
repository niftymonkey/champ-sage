import type { EffectiveGameState } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { CoachingFeed, GamePlanPanel } from "./coaching";
import { EnemyStrip } from "./EnemyStrip";
import { useCoachingFeed } from "../hooks/useCoachingFeed";
import { useGamePlan } from "../hooks/useGamePlan";
import { useLastGameMeta } from "../hooks/useLastGameMeta";
import { resultLabel } from "../lib/game-result";
import styles from "./InGameView.module.css";

interface InGameViewProps {
  state: EffectiveGameState;
  gameData: LoadedGameData;
}

/**
 * Game surface — conversation feed (left, the only scrolling region)
 * + game-plan stack (right). Active during a live match and persists
 * the just-finished match's content after the game ends so the player
 * can scroll back through it without bouncing to History.
 *
 * Three render states:
 *   1. Live game in progress — no banner, normal layout, enemy strip
 *      reads from the live state.
 *   2. Game just ended same session, feed/plan still in memory — "Last
 *      game" banner above the layout so the player can scroll back
 *      through what just happened. Enemy strip drops out (live-only).
 *      Cross-launch state intentionally falls through to (3): the
 *      banner without in-memory feed content reads as "you have nothing
 *      to scroll back to," which is misleading.
 *   3. Truly empty (fresh launch, between sessions, or never played) —
 *      a calm "No live game" empty state.
 */
export function InGameView({ state, gameData }: InGameViewProps) {
  const feed = useCoachingFeed();
  const plan = useGamePlan();
  const lastGame = useLastGameMeta();
  const isLive = state.status === "connected";
  // Only count *in-memory* signals here. Persistent signals like match
  // history make `lastGame.championName` non-null even on a fresh
  // launch, which used to drop the user into the banner-+-empty-columns
  // state with two redundant "waiting for…" messages.
  const hasInSessionContent = feed.length > 0 || plan !== null;

  if (!isLive && !hasInSessionContent) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No live game yet.</p>
        <p className={styles.emptyBody}>
          The coach picks up the moment League sends us live state. Start a
          match and this surface will fill in with the running plan, the
          conversation, and what the enemy team is building.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.surface}>
      {!isLive ? (
        <div className={styles.endedBanner}>
          <span className={styles.endedLabel}>Last game</span>
          {lastGame.championName ? (
            <span className={styles.endedMeta}>
              {lastGame.championName}
              {lastGame.result !== null
                ? ` · ${resultLabel(lastGame.result).toLowerCase()}`
                : ""}
            </span>
          ) : null}
          <span className={styles.endedNote}>
            game over — viewing the recorded snapshot
          </span>
        </div>
      ) : null}
      <div className={styles.columns}>
        <section className={styles.left}>
          <CoachingFeed />
        </section>
        <aside className={styles.right}>
          <GamePlanPanel />
          {isLive ? (
            <EnemyStrip enemies={state.enemies} gameData={gameData} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
