import type { BuildPathItem } from "../../lib/ai/types";
import { useGamePlan } from "../../hooks/useGamePlan";
import { useLiveGameState } from "../../hooks/useLiveGameState";
import { BuildPathIcon, BUILD_PATH_CATEGORY_LABELS } from "./BuildPathIcon";
import styles from "./GamePlanPanel.module.css";

export function GamePlanPanel() {
  const plan = useGamePlan();
  const liveGameState = useLiveGameState();
  const ownedNames = useOwnedItemNames(liveGameState);

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
              <BuildStep
                key={`${item.name}-${i}`}
                index={i}
                item={item}
                owned={ownedNames.has(item.name.toLowerCase())}
              />
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

function useOwnedItemNames(
  liveGameState: ReturnType<typeof useLiveGameState>
): ReadonlySet<string> {
  const active = liveGameState.players.find((p) => p.isActivePlayer);
  return new Set((active?.items ?? []).map((i) => i.name.toLowerCase()));
}

function BuildStep({
  index,
  item,
  owned,
}: {
  index: number;
  item: BuildPathItem;
  owned: boolean;
}) {
  const tooltip = formatTooltip(item, owned);
  return (
    <div
      className={[
        styles.buildStep,
        styles[`cat_${item.category}`] ?? "",
        owned ? styles.owned : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={tooltip}
    >
      <span className={styles.buildNum}>{index + 1}</span>
      <BuildPathIcon category={item.category} className={styles.buildIcon} />
      <span className={styles.buildName}>{item.name}</span>
      {owned ? <span className={styles.ownedBadge}>owned</span> : null}
      {item.category === "counter" && item.targetEnemy ? (
        <span className={styles.counterTarget}>vs {item.targetEnemy}</span>
      ) : null}
    </div>
  );
}

function formatTooltip(item: BuildPathItem, owned: boolean): string {
  const label = BUILD_PATH_CATEGORY_LABELS[item.category];
  const header =
    item.category === "counter" && item.targetEnemy
      ? `${label} — ${item.targetEnemy}`
      : label;
  const body = item.reason ? `${header}: ${item.reason}` : header;
  return owned ? `${body} (already owned)` : body;
}

function formatGameTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
