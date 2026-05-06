import { useEffect, useState } from "react";
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
  const relative = useRelativeTime(payload.timestamp);
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
        <span className={styles.timestamp}>{relative}</span>
      </div>
      <p className={styles.answer}>{payload.answer}</p>
    </div>
  );
}

/**
 * Re-derives the relative-time label every second so a card sitting in
 * the slot for minutes doesn't keep reading "now". A 1s tick is plenty
 * granular for the labels we render.
 */
function useRelativeTime(timestamp: number): string {
  const [label, setLabel] = useState(() => formatRelative(timestamp));
  useEffect(() => {
    setLabel(formatRelative(timestamp));
    const interval = setInterval(
      () => setLabel(formatRelative(timestamp)),
      1000
    );
    return () => clearInterval(interval);
  }, [timestamp]);
  return label;
}

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
