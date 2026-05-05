import styles from "./cards.module.css";

interface EmptyPromptCardProps {
  /** Display label for the push-to-talk binding, e.g. "Num -" or "Alt + Space". */
  hotkeyLabel: string;
}

/**
 * The whisper-quiet prompt that teaches the push-to-talk gesture. Per v16
 * spec it shows for the first 30s of a new game's overlay session and after
 * extended silence (when the player hasn't yet learned the gesture). The
 * resolver decides when this card lives in the slot; this component just
 * renders the body.
 */
export function EmptyPromptCard({ hotkeyLabel }: EmptyPromptCardProps) {
  return (
    <div
      className={`${styles.card} ${styles.empty}`}
      data-testid="slot-card-empty"
    >
      <div className={styles.header}>
        <span className={styles.chip}>
          <span className={styles.chipKeyword}>coach</span>
          <span className={styles.chipSep}>·</span>
          <span>listening</span>
        </span>
      </div>
      <p className={styles.emptyBody}>
        Hold <span className={styles.emptyHotkey}>{hotkeyLabel}</span> to ask
        anything.
      </p>
    </div>
  );
}
