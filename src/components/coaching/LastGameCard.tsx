import { useLastGameSnapshot } from "../../hooks/useLastGameSnapshot";
import styles from "./LastGameCard.module.css";

interface LastGameCardProps {
  dataVersion: string;
  championCount: number;
  itemCount: number;
  augmentCount: number;
}

export function LastGameCard({
  dataVersion,
  championCount,
  itemCount,
  augmentCount,
}: LastGameCardProps) {
  const snapshot = useLastGameSnapshot();

  return (
    <div className={styles.container}>
      {snapshot ? (
        <GameSummary snapshot={snapshot} />
      ) : (
        <div className={styles.waiting}>Waiting for game...</div>
      )}
      <div className={styles.meta}>
        Patch {dataVersion} — {championCount} champions · {itemCount} items ·{" "}
        {augmentCount} augments
      </div>
    </div>
  );
}

interface GameSummaryProps {
  snapshot: {
    championName: string;
    isWin: boolean;
    kills: number;
    deaths: number;
    assists: number;
    gameTime: number;
    gameMode: string;
    items: string[];
    recentExchanges: Array<{ question: string; answer: string }>;
  };
}

function GameSummary({ snapshot }: GameSummaryProps) {
  const duration = formatDuration(snapshot.gameTime);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.champName}>{snapshot.championName}</span>
        <span
          className={`${styles.result} ${snapshot.isWin ? styles.win : styles.loss}`}
        >
          {snapshot.isWin ? "VICTORY" : "DEFEAT"}
        </span>
      </div>
      <div className={styles.stats}>
        <span>
          <strong>
            <span className={styles.kdaKills}>{snapshot.kills}</span>
            <span className={styles.kdaSep}>•</span>
            <span className={styles.kdaDeaths}>{snapshot.deaths}</span>
            <span className={styles.kdaSep}>•</span>
            <span className={styles.kdaAssists}>{snapshot.assists}</span>
          </strong>{" "}
          KDA
        </span>
        <span>
          <strong>{duration}</strong> Duration
        </span>
        <span>
          <strong>{snapshot.gameMode}</strong>
        </span>
      </div>
      {snapshot.items.length > 0 && (
        <div className={styles.items}>
          {snapshot.items.map((item, i) => (
            <span key={`${item}-${i}`} className={styles.item}>
              {item}
            </span>
          ))}
        </div>
      )}
      {snapshot.recentExchanges.length > 0 && (
        <div className={styles.exchanges}>
          {snapshot.recentExchanges.map((ex, i) => (
            <div key={i} className={styles.exchange}>
              <div className={styles.exchangeQ}>You: {ex.question}</div>
              <div className={styles.exchangeA}>{ex.answer}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
