import { useEffect, useRef } from "react";
import type { BuildPathItem } from "../../lib/ai/types";
import { useGamePlan } from "../../hooks/useGamePlan";
import { useLiveGameState } from "../../hooks/useLiveGameState";
import { usePlayerBuildDirection } from "../../hooks/usePlayerBuildDirection";
import { useCoachingContext } from "../../hooks/useCoachingContext";
import { setPlayerBuildDirection } from "../../lib/reactive/build-direction-store";
import { stereotypeFromClassTag } from "../../lib/build-direction/taxonomy";
import { BuildDirectionPicker } from "../BuildDirectionPicker";
import { BuildPathIcon, BUILD_PATH_CATEGORY_LABELS } from "./BuildPathIcon";
import { getLogger } from "../../lib/logger";
import styles from "./GamePlanPanel.module.css";

const log = getLogger("build-direction");

export function GamePlanPanel() {
  const plan = useGamePlan();
  const liveGameState = useLiveGameState();
  const { gameData } = useCoachingContext();
  const ownedNames = useOwnedItemNames(liveGameState);
  const playerDirection = usePlayerBuildDirection();
  const inGame = liveGameState.activePlayer !== null;
  // Look up the active player's champion so the picker can render the
  // dashed-stereotype indicator (matches the in-champ-select picker
  // affordance — without this prop the in-game picker reads as
  // "nothing selected" even when the user expected a default hint).
  const activeChampion =
    inGame && gameData && liveGameState.activePlayer
      ? (gameData.champions.get(
          liveGameState.activePlayer.championName.toLowerCase()
        ) ?? undefined)
      : undefined;

  // Diagnostic: log the picker's effective inputs once per championName
  // change so the log lets us tell from outside whether the in-game
  // dashed-stereotype indicator should be visible. Catches the silent
  // case where the Live Client's championName doesn't match the
  // DDragon catalog key (e.g. Wukong vs MonkeyKing) — without this we
  // can't distinguish "lookup missed" from "user picked nothing".
  const championName = liveGameState.activePlayer?.championName ?? null;
  const lastLoggedChampionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!inGame || !championName) return;
    if (lastLoggedChampionRef.current === championName) return;
    lastLoggedChampionRef.current = championName;
    if (!gameData) {
      log.info(
        `In-game picker: gameData not loaded yet (championName=${championName})`
      );
      return;
    }
    if (!activeChampion) {
      log.warn(
        `In-game picker: champion lookup MISS for "${championName}" (lowercased "${championName.toLowerCase()}"); dashed-stereotype indicator will not render`
      );
      return;
    }
    const stereotype = stereotypeFromClassTag(activeChampion.tags?.[0]);
    log.info(
      `In-game picker: champion=${activeChampion.name} tags=[${(activeChampion.tags ?? []).join(",")}] stereotype=${stereotype ?? "null"}`
    );
  }, [inGame, championName, gameData, activeChampion]);

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <h2 className={styles.headingTitle}>Game plan</h2>
        {plan ? (
          <span className={styles.headingMeta}>
            updated {formatGameTime(plan.updatedAt)}
          </span>
        ) : null}
      </div>
      {inGame ? (
        <div className={styles.directionRow}>
          <span className={styles.directionLabel}>Build direction</span>
          <BuildDirectionPicker
            value={playerDirection}
            onChange={setPlayerBuildDirection}
            champion={activeChampion}
            size="compact"
          />
        </div>
      ) : null}
      {plan ? (
        <>
          <div className={styles.summary}>{plan.summary}</div>
          <div className={styles.buildTitle}>Build path</div>
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
        </>
      ) : (
        <div className={styles.empty}>The coach is drafting the plan.</div>
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
