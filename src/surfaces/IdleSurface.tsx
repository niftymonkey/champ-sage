import type { LoadedGameData } from "../lib/data-ingest";
import type { GameLifecycleEvent, GameflowPhase } from "../lib/reactive/types";
import { useLastGameSnapshot } from "../hooks/useLastGameSnapshot";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import styles from "./IdleSurface.module.css";

interface IdleSurfaceProps {
  data: LoadedGameData;
  lifecycle: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
  championName: string | null;
}

/**
 * Home view for the v16 redesign. Two-column rhythm: hero + 3-stat strip +
 * pinned notes on the left, last-game callout + connection pill on the
 * right. Real data for the stat strip / pinned notes / recent games list
 * comes in Phase 5 once match-history aggregation and the coach-decision
 * log land. Until then those blocks render representative placeholder
 * content so the layout reads finished, not gutted.
 */
export function IdleSurface({
  data,
  lifecycle,
  lastPhase,
  championName,
}: IdleSurfaceProps) {
  const lastGame = useLastGameSnapshot();

  return (
    <div className={styles.surface}>
      <section className={styles.left}>
        <div>
          <div className={styles.heroEyebrow}>Welcome back</div>
          <h1 className={styles.headline}>
            Ready when you are
            <span className={styles.headlineAccent}> for the next game</span>.
          </h1>
          <p className={styles.heroBody}>
            The coach is watching the League client and will pick up the moment
            you queue. Pattern reads across recent games will appear here once
            Phase 5 lands match-history aggregation.
          </p>
        </div>

        <div className={styles.statStrip}>
          <StatBox label="Last 7 days" value="—" delta="No data yet" />
          <StatBox label="Avg KDA" value="—" delta="No data yet" />
          <StatBox
            label="Coach interventions"
            value="—"
            delta="Tracking begins next game"
          />
        </div>

        <div>
          <div className={styles.sectionLabel}>Pinned for next time</div>
          <div className={styles.notes}>
            <PlaceholderNote body="Pinned notes from past games will live here once the coach-decision log is wired (Phase 5)." />
          </div>
        </div>
      </section>

      <aside className={styles.right}>
        <ConnectionPill
          lifecycle={lifecycle}
          lastPhase={lastPhase}
          championName={championName}
        />

        <div>
          <div className={styles.sectionLabel}>Last game</div>
          {lastGame ? (
            <LastGameBlock snapshot={lastGame} />
          ) : (
            <p className={styles.lastGameStats}>
              No game played in this session yet.
            </p>
          )}
        </div>

        <div>
          <div className={styles.sectionLabel}>Recent games</div>
          <div className={styles.recent}>
            <PlaceholderRecentRow />
            <PlaceholderRecentRow />
            <PlaceholderRecentRow />
          </div>
        </div>

        <div className={styles.dataset}>
          Patch {data.version} · {data.champions.size} champions ·{" "}
          {data.items.size} items · {data.augments.size} augments
        </div>
      </aside>
    </div>
  );
}

interface StatBoxProps {
  label: string;
  value: string;
  delta: string;
}

function StatBox({ label, value, delta }: StatBoxProps) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statDelta}>{delta}</div>
    </div>
  );
}

function PlaceholderNote({ body }: { body: string }) {
  return (
    <div className={styles.note}>
      <p className={styles.noteBody}>{body}</p>
      <span className={styles.noteMeta}>From — · waiting for first game</span>
    </div>
  );
}

function PlaceholderRecentRow() {
  return (
    <div className={styles.recentRow}>
      <span className={styles.recentChamp}>—</span>
      <span className={styles.recentMode}>Mayhem</span>
      <span className={`${styles.recentResult}`}>—</span>
      <span className={styles.recentKda}>—</span>
      <span className={styles.recentAgo}>—</span>
    </div>
  );
}

function LastGameBlock({ snapshot }: { snapshot: LastGameSnapshot }) {
  const exchange = snapshot.recentExchanges[0];
  return (
    <div className={styles.lastGameBlock}>
      <div className={styles.lastGameHeader}>
        <span className={styles.lastGameChamp}>{snapshot.championName}</span>
        <span
          className={`${styles.lastGameResult} ${
            snapshot.isWin ? styles.recentResultWin : styles.recentResultLoss
          }`}
        >
          {snapshot.isWin ? "Win" : "Loss"}
        </span>
      </div>
      <div className={styles.lastGameStats}>
        <span>
          {snapshot.kills} / {snapshot.deaths} / {snapshot.assists}
        </span>
        <span>·</span>
        <span>{formatDuration(snapshot.gameTime)}</span>
        <span>·</span>
        <span>{snapshot.gameMode}</span>
      </div>
      {exchange ? (
        <>
          <p className={styles.lastGameQuestion}>{exchange.question}</p>
          <p className={styles.lastGameAnswer}>{exchange.answer}</p>
        </>
      ) : null}
    </div>
  );
}

interface ConnectionPillProps {
  lifecycle: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
  championName: string | null;
}

/**
 * Replaces the old rune-circle ConnectionStatus. The redesign keeps system
 * status to a tight pill in the top-right of the right column - no
 * decorative iconography per the v16 spec.
 */
function ConnectionPill({
  lifecycle,
  lastPhase,
  championName,
}: ConnectionPillProps) {
  const { label, dotClass } = describeConnection({
    lifecycle,
    lastPhase,
    championName,
  });

  return (
    <span className={styles.connectionPill}>
      <span className={`${styles.connectionDot} ${dotClass}`} />
      {label}
    </span>
  );
}

function describeConnection({
  lifecycle,
  lastPhase,
  championName,
}: ConnectionPillProps): { label: string; dotClass: string } {
  if (lifecycle.type === "connection") {
    return lifecycle.connected
      ? {
          label: "League client connected",
          dotClass: styles.connectionDotConnected,
        }
      : {
          label: "Waiting for League client",
          dotClass: styles.connectionDot,
        };
  }
  switch (lastPhase) {
    case "Lobby":
      return { label: "Lobby", dotClass: styles.connectionDotActive };
    case "Matchmaking":
      return { label: "Searching", dotClass: styles.connectionDotActive };
    case "ReadyCheck":
      return { label: "Match found", dotClass: styles.connectionDotActive };
    case "ChampSelect":
      return {
        label: championName ? `Champ select - ${championName}` : "Champ select",
        dotClass: styles.connectionDotActive,
      };
    case "TerminatedInError":
      return { label: "Game terminated", dotClass: styles.connectionDotError };
    default:
      return {
        label: "League client connected",
        dotClass: styles.connectionDotConnected,
      };
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
