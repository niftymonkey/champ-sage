import { resolveSummonerSpellName } from "../lib/data-ingest/summoner-spells";
import styles from "./SummonerSpellImport.module.css";

export type SummonerSpellImportStatus = "idle" | "importing" | "done" | "error";

export interface SummonerSpellImportProps {
  spell1Id: number;
  spell2Id: number;
  status: SummonerSpellImportStatus;
  onImport: () => void;
}

/**
 * Champ-select affordance that shows the meta-recommended summoner-spell pair
 * and a one-click Import button to write it into the League client. Purely
 * presentational: the caller owns the recommendation, the click handler, and
 * the import status. Recommendation is by pick popularity; no win-rate number is
 * ever shown (win rates are banned for augments/Arena items, so the app stays
 * clear of that line by design).
 */
export function SummonerSpellImport({
  spell1Id,
  spell2Id,
  status,
  onImport,
}: SummonerSpellImportProps) {
  const pair = `${resolveSummonerSpellName(spell1Id)} + ${resolveSummonerSpellName(spell2Id)}`;

  return (
    <div className={styles.container}>
      <div className={styles.label}>Summoner spells</div>
      <div className={styles.pair}>{pair}</div>
      <button
        type="button"
        className={styles.button}
        disabled={status === "importing"}
        onClick={onImport}
      >
        {BUTTON_LABEL[status]}
      </button>
      {status === "error" ? (
        <div className={styles.error}>Couldn&apos;t set spells</div>
      ) : null}
    </div>
  );
}

const BUTTON_LABEL: Record<SummonerSpellImportStatus, string> = {
  idle: "Import",
  importing: "Importing…",
  done: "Imported",
  error: "Retry",
};
