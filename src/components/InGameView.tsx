import type { EffectiveGameState } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { CoachingFeed, GamePlanPanel } from "./coaching";
import { EnemyStrip } from "./EnemyStrip";
import styles from "./InGameView.module.css";

interface InGameViewProps {
  state: EffectiveGameState;
  gameData: LoadedGameData;
}

/**
 * In-game surface — two-column rhythm matching the rest of the v16
 * design: conversation feed (left, the only scrolling region) +
 * game-plan stack (right, fits the viewport at a glance — plan
 * summary, build path, enemy team).
 *
 * Renders a single empty state when there is no live game and no
 * coach activity to surface — avoids the awkward two-column layout
 * with overlapping "waiting" copy that read as broken.
 */
export function InGameView({ state, gameData }: InGameViewProps) {
  const isLive = state.status === "connected";
  if (!isLive) {
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
      <section className={styles.left}>
        <CoachingFeed />
      </section>
      <aside className={styles.right}>
        <GamePlanPanel />
        <EnemyStrip enemies={state.enemies} gameData={gameData} />
      </aside>
    </div>
  );
}
