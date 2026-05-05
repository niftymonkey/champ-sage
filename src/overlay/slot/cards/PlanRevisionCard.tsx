import type { PlanRevisionPayload } from "../types";
import styles from "./cards.module.css";

interface PlanRevisionCardProps {
  payload: PlanRevisionPayload;
  /** Optional callback so the host can wire the "tap to ask why" affordance
   *  to a pre-staged voice prompt. When undefined, the hint stays visible
   *  but the card doesn't act on the click. */
  onAskWhy?: () => void;
}

/**
 * Mid-game build pivot. The coach updated the plan in the desktop feed;
 * this is the polite knock that surfaces the change in the in-game slot.
 * Per v16 spec, the body is 1-2 sentences with a 2px oxblood left border
 * and an optional "tap to ask why" hint.
 */
export function PlanRevisionCard({ payload, onAskWhy }: PlanRevisionCardProps) {
  return (
    <div
      className={`${styles.card} ${styles.planRevision}`}
      data-testid="slot-card-plan-revision"
    >
      <div className={styles.header}>
        <span className={styles.chip}>
          <span className={styles.chipKeyword}>coach</span>
          <span className={styles.chipSep}>·</span>
          <span>plan rev {payload.rev}</span>
        </span>
        <span className={styles.timestamp}>now</span>
      </div>
      <p className={styles.answer}>{payload.summary}</p>
      {onAskWhy ? (
        <button
          type="button"
          className={styles.hint}
          onClick={onAskWhy}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          tap to ask why
        </button>
      ) : (
        <p className={styles.hint}>tap to ask why</p>
      )}
    </div>
  );
}
