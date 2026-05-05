import type { ThreatSpikePayload } from "../types";
import styles from "./cards.module.css";

interface ThreatSpikeCardProps {
  payload: ThreatSpikePayload;
}

/**
 * Loud, interruptive overlay that surfaces when the coach detects something
 * dangerous. Built but unwired in Phase 4: the resolver suppresses the
 * threat-spike variant until the Riot policy gate (Phase 0) clears.
 *
 * Per v16 spec the body is front-loaded - the threat noun in --threat-hi
 * comes first, then the explanation in normal coach voice.
 */
export function ThreatSpikeCard({ payload }: ThreatSpikeCardProps) {
  return (
    <div
      className={`${styles.card} ${styles.threatSpike}`}
      data-testid="slot-card-threat-spike"
    >
      <div className={styles.header}>
        <span className={styles.chip}>
          <span className={`${styles.chipKeyword} ${styles.chipKeywordThreat}`}>
            coach
          </span>
          <span className={styles.chipSep}>·</span>
          <span>threat</span>
        </span>
        <span className={styles.timestamp}>now · 6s</span>
      </div>
      <p className={styles.answer}>
        <span className={styles.threatNoun}>{payload.threat}</span>
        <span> · {payload.reason}</span>
      </p>
    </div>
  );
}
