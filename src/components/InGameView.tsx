import type { EffectiveGameState } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { CoachingFeed, GamePlanPanel } from "./coaching";
import { EnemyStrip } from "./EnemyStrip";
import styles from "./InGameView.module.css";

interface InGameViewProps {
  state: EffectiveGameState;
  gameData: LoadedGameData;
}

export function InGameView({ state, gameData }: InGameViewProps) {
  return (
    <div className={styles.root}>
      <div className={styles.contentRow}>
        <CoachingFeed />
        <GamePlanPanel />
      </div>
      <EnemyStrip enemies={state.enemies} gameData={gameData} />
    </div>
  );
}
