import type { VoiceAnswerPayload } from "../types";
import styles from "./cards.module.css";

interface VoiceRestingCardProps {
  payload: VoiceAnswerPayload;
  /** When true, the card has been pinned by long-press and shows a
   *  thin oxblood top border. */
  pinned: boolean;
}

/**
 * The canonical resting overlay - sits in the bottom-right slot after the
 * coach has answered a voice question. Per v16 spec, the player's spoken
 * question reads as italic Fraunces in --quote teal above the coach's
 * answer body in italic Fraunces warm-bone.
 */
export function VoiceRestingCard({ payload, pinned }: VoiceRestingCardProps) {
  return (
    <div
      className={`${styles.card} ${pinned ? styles.pinned : ""}`}
      data-testid="slot-card-voice-resting"
    >
      <p className={styles.question}>{payload.question}</p>
      <div className={styles.header}>
        <span className={styles.chip}>
          <span className={styles.dot} />
          <span className={styles.chipKeyword}>coach</span>
          <span className={styles.chipSep}>·</span>
          <span>answering you · via voice</span>
        </span>
        <span className={styles.timestamp}>
          {formatRelative(payload.timestamp)}
        </span>
      </div>
      <p className={styles.answer}>{payload.answer}</p>
    </div>
  );
}

function formatRelative(_timestamp: number): string {
  // Wall-clock-to-relative formatting is host-driven (e.g. "now", "12s")
  // and depends on the current frame; keep it static for the slot test
  // surface and let the host pass a pre-formatted string in a future pass.
  return "now";
}
