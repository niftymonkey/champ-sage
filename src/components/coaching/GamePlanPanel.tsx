import type { BuildPathItem } from "../../lib/ai/types";
import { useGamePlan } from "../../hooks/useGamePlan";
import { BuildPathIcon, BUILD_PATH_CATEGORY_LABELS } from "./BuildPathIcon";
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
              <BuildStep key={`${item.name}-${i}`} index={i} item={item} />
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

function BuildStep({ index, item }: { index: number; item: BuildPathItem }) {
  const tooltip = formatTooltip(item);
  return (
    <div
      className={`${styles.buildStep} ${styles[`cat_${item.category}`] ?? ""}`}
      title={tooltip}
    >
      <span className={styles.buildNum}>{index + 1}</span>
      <BuildPathIcon category={item.category} className={styles.buildIcon} />
      <span className={styles.buildName}>{item.name}</span>
      {item.category === "counter" && item.targetEnemy ? (
        <span className={styles.counterTarget}>vs {item.targetEnemy}</span>
      ) : null}
    </div>
  );
}

function formatTooltip(item: BuildPathItem): string {
  const label = BUILD_PATH_CATEGORY_LABELS[item.category];
  const header =
    item.category === "counter" && item.targetEnemy
      ? `${label} — ${item.targetEnemy}`
      : label;
  return item.reason ? `${header}: ${item.reason}` : header;
}

function formatGameTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
