import { useMemo, type ReactNode } from "react";
import type { GameLifecycleEvent, GameflowPhase } from "../lib/reactive/types";
import { useLastGameSnapshot } from "../hooks/useLastGameSnapshot";
import { useLastGameMeta } from "../hooks/useLastGameMeta";
import { useMatchHistory } from "../hooks/useMatchHistory";
import { useDecisionLogQuery } from "../hooks/useDecisionLogQuery";
import { useLcuConnected } from "../hooks/useLcuConnected";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import type { MatchSummary } from "../lib/match-history/types";
import { formatGameMode } from "../lib/format-game-mode";
import styles from "./IdleSurface.module.css";

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_GAMES_QUERY = { kind: "recent-games", n: 50 } as const;
const OFFLINE_HINT = "League client offline";

interface IdleSurfaceProps {
  lifecycle: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
  championName: string | null;
  /**
   * Click handler for a recent-games row. App routes to the post-game
   * surface for that specific Riot gameId. Optional so the surface
   * still renders without click behavior in tests / storybook.
   */
  onSelectGame?: (gameId: string) => void;
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
  lifecycle,
  lastPhase,
  championName,
  onSelectGame,
}: IdleSurfaceProps) {
  const lastGame = useLastGameSnapshot();
  const {
    windowStats,
    recentGames,
    loading: matchesLoading,
  } = useMatchHistory();
  const lcuConnected = useLcuConnected();
  const stats = useMemo(
    () => windowStats({ days: WINDOW_DAYS }),
    [windowStats]
  );
  const recent = useMemo(() => recentGames(5), [recentGames]);
  const { records: recentDecisions, loading: decisionsLoading } =
    useDecisionLogQuery(RECENT_GAMES_QUERY);
  // "Loading" only counts when we expect data to land — i.e. the LCU is
  // up. If the client is offline we already show the offline copy and
  // shouldn't spin a fake ellipsis.
  const matchesLoadingNow = matchesLoading && lcuConnected;
  const decisionsLoadingNow = decisionsLoading;
  // Coaching moments are persisted to disk and survive across launches —
  // unlike `matches.length` which is in-memory and only populated when
  // the LCU has been reachable this session. Counting unique gameIds in
  // the decision log gives a denominator that always matches the numerator.
  const { interventionCount, interventionMatchCount } = useMemo(() => {
    const cutoff = Date.now() - WINDOW_DAYS * DAY_MS;
    const inWindow = recentDecisions.filter((r) => r.sentAt >= cutoff);
    const gameIds = new Set<string>();
    for (const r of inWindow) gameIds.add(r.gameId);
    return {
      interventionCount: inWindow.length,
      interventionMatchCount: gameIds.size,
    };
  }, [recentDecisions]);

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
            you queue. Below: your last week of matches, pulled live from the
            League client, with how often the coach weighed in.
          </p>
        </div>

        <div className={styles.statStrip}>
          <StatBox
            label="Last 7 days"
            value={
              stats.totalGames > 0 ? (
                `${stats.wins}-${stats.losses}`
              ) : matchesLoadingNow ? (
                <LoadingDots />
              ) : (
                "—"
              )
            }
            delta={
              stats.totalGames > 0
                ? `${stats.totalGames} ${stats.totalGames === 1 ? "game" : "games"}`
                : matchesLoadingNow
                  ? "Pulling match history…"
                  : lcuConnected
                    ? "No matches yet"
                    : OFFLINE_HINT
            }
          />
          <StatBox
            label="Avg KDA"
            value={
              stats.totalGames > 0 ? (
                stats.avgKDA.toFixed(2)
              ) : matchesLoadingNow ? (
                <LoadingDots />
              ) : (
                "—"
              )
            }
            delta={
              stats.totalGames > 0
                ? `${stats.totalKills}/${stats.totalDeaths}/${stats.totalAssists} total`
                : matchesLoadingNow
                  ? "Pulling match history…"
                  : lcuConnected
                    ? "No matches yet"
                    : OFFLINE_HINT
            }
          />
          <StatBox
            label="Coaching moments"
            value={
              interventionCount > 0 ? (
                String(interventionCount)
              ) : decisionsLoadingNow ? (
                <LoadingDots />
              ) : (
                "—"
              )
            }
            delta={
              interventionCount > 0
                ? `across ${interventionMatchCount} ${interventionMatchCount === 1 ? "match" : "matches"}`
                : decisionsLoadingNow
                  ? "Reading the decision log…"
                  : "Tracking begins next game"
            }
          />
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
            {recent.length === 0 ? (
              <p className={styles.recentEmpty}>
                {lcuConnected
                  ? "No matches in your client history yet."
                  : "League client offline — recent matches load once the client is up."}
              </p>
            ) : (
              recent.map((m) => (
                <RecentGameRow
                  key={m.gameId}
                  match={m}
                  onSelect={onSelectGame}
                />
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function RecentGameRow({
  match,
  onSelect,
}: {
  match: MatchSummary;
  onSelect?: (gameId: string) => void;
}) {
  const clickable = onSelect !== undefined;
  const handleClick = clickable ? () => onSelect?.(match.gameId) : undefined;
  const handleKey = clickable
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(match.gameId);
        }
      }
    : undefined;
  return (
    <div
      className={`${styles.recentRow} ${clickable ? styles.recentRowClickable : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKey}
    >
      <span className={styles.recentChamp}>{match.championName}</span>
      <span className={styles.recentMode}>
        {formatGameMode(match.gameMode)}
      </span>
      <span
        className={`${styles.recentResult} ${match.isWin ? styles.recentResultWin : styles.recentResultLoss}`}
      >
        {match.isWin ? "Win" : "Loss"}
      </span>
      <span className={styles.recentKda}>
        {match.kills}/{match.deaths}/{match.assists}
      </span>
      <span className={styles.recentAgo}>
        {formatRelativeTime(match.gameCreation)}
      </span>
    </div>
  );
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface StatBoxProps {
  label: string;
  value: ReactNode;
  delta: ReactNode;
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

function LoadingDots() {
  return (
    <span className={styles.loadingDots} aria-label="Loading">
      <span>·</span>
      <span>·</span>
      <span>·</span>
    </span>
  );
}

function LastGameBlock({ snapshot }: { snapshot: LastGameSnapshot }) {
  const exchange = snapshot.recentExchanges[0];
  // Single source of truth for "what was the last game's result" —
  // see useLastGameMeta. Prefers match-history (server-authoritative)
  // over the in-memory snapshot, which has been observed to default
  // to a loss when the LCU's eog-stats-block returns null.
  const meta = useLastGameMeta();
  const isWin = meta.isWin ?? false;
  const gameMode = formatGameMode(meta.gameMode);
  const championName = meta.championName ?? snapshot.championName;
  return (
    <div className={styles.lastGameBlock}>
      <div className={styles.lastGameHeader}>
        <span className={styles.lastGameChamp}>{championName}</span>
        <span
          className={`${styles.lastGameResult} ${
            isWin ? styles.recentResultWin : styles.recentResultLoss
          }`}
        >
          {isWin ? "Win" : "Loss"}
        </span>
      </div>
      <div className={styles.lastGameStats}>
        <span>
          {meta.kills ?? snapshot.kills} / {meta.deaths ?? snapshot.deaths} /{" "}
          {meta.assists ?? snapshot.assists}
        </span>
        <span>·</span>
        <span>{formatDuration(meta.duration ?? snapshot.gameTime)}</span>
        <span>·</span>
        <span>{gameMode}</span>
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
