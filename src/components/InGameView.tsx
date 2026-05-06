import type { EffectiveGameState } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { CoachingFeed, GamePlanPanel } from "./coaching";
import { EnemyStrip } from "./EnemyStrip";
import { useCoachingFeed } from "../hooks/useCoachingFeed";
import { useGamePlan } from "../hooks/useGamePlan";
import { useLastGameMeta } from "../hooks/useLastGameMeta";
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
 *   2. Game just ended but feed/plan still in memory — "Last game"
 *      banner above the layout. Enemy strip drops out (its data
 *      depends on live polling). Tracking for Issue #84 (rejoin a
 *      specific past game) will eventually replace this with an
 *      explicit "viewing match X" affordance.
 *   3. Truly empty (fresh launch, never played) — a calm "No live
 *      game" empty state.
 */
export function InGameView({ state, gameData }: InGameViewProps) {
  const feed = useCoachingFeed();
  const plan = useGamePlan();
  const lastGame = useLastGameMeta();
  const isLive = state.status === "connected";
  const hasPastContent =
    feed.length > 0 || plan !== null || lastGame.championName !== null;

  if (!isLive && !hasPastContent) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No live game.</p>
        <p className={styles.emptyBody}>
          The coach picks up the moment League sends us live state. Until then
          there is nothing to show.
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
              {lastGame.isWin !== null
                ? ` · ${lastGame.isWin ? "win" : "loss"}`
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
