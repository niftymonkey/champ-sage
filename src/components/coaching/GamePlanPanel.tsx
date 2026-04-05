import { useGamePlan } from "../../hooks/useGamePlan";
import styles from "./GamePlanPanel.module.css";

export function GamePlanPanel() {
  const plan = useGamePlan();

  return (
    <div className={styles.panel}>
      <div className={styles.title}>
        <span className={styles.titleDot} />
        Game Plan
      </div>
      {plan ? (
        <>
          <div className={styles.summary}>{plan.summary}</div>
          <div className={styles.buildTitle}>Build Path</div>
          <div className={styles.buildList}>
            {plan.buildPath.map((item, i) => (
              <div key={`${item}-${i}`} className={styles.buildStep}>
                <span className={styles.buildNum}>{i + 1}</span>
                {item}
              </div>
            ))}
          </div>
          <div className={styles.updated}>
            Updated at {formatGameTime(plan.updatedAt)}
          </div>
        </>
      ) : (
        <div className={styles.empty}>Waiting for game to start...</div>
      )}
    </div>
  );
}

function formatGameTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
