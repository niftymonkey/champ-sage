import { useMemo, type ReactNode } from "react";
import type { GameLifecycleEvent, GameflowPhase } from "../lib/reactive/types";
import { useLastGameSnapshot } from "../hooks/useLastGameSnapshot";
import { useLastGameMeta, type LastGameMeta } from "../hooks/useLastGameMeta";
import { useMatchHistory } from "../hooks/useMatchHistory";
import { useDecisionLogQuery } from "../hooks/useDecisionLogQuery";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import type { MatchSummary } from "../lib/match-history/types";
import type { VoiceDecision } from "../lib/decision-log/types";
import { formatGameMode } from "../lib/format-game-mode";
import styles from "./IdleSurface.module.css";

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_GAMES_QUERY = { kind: "recent-games", n: 50 } as const;

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
  const meta = useLastGameMeta();
  const { windowStats, recentGames, isValidating: matchesValidating } =
    useMatchHistory();
  const stats = useMemo(
    () => windowStats({ days: WINDOW_DAYS }),
    [windowStats]
  );
  const recent = useMemo(() => recentGames(5), [recentGames]);
  const { records: recentDecisions, isValidating: decisionsValidating } =
    useDecisionLogQuery(RECENT_GAMES_QUERY);
  // The pulsing-dots affordance pulses ONLY when a real revalidation is
  // in flight — SWR has been told (by an LCU-connect or game-end trigger,
  // or by the decision-log IPC fan-out in <SWRBridge>) to re-pull. Cached
  // values render unconditionally; the dots are the visible "we're
  // refreshing" signal, not a fake spinner.
  const matchesLoadingNow = matchesValidating;
  const decisionsLoadingNow = decisionsValidating;
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

  // Last-completed-game's most recent voice exchange — fallback for the
  // LastGameBlock Q&A snippet when the in-memory snapshot is absent
  // (post-restart, no live session yet). Voice records are sorted ascending
  // by `sentAt` per `summarizeGame`, so `.at(-1)` is the most recent.
  const lastVoice = useMemo<VoiceDecision | null>(() => {
    if (meta.gameId === null) return null;
    const voicesForGame = recentDecisions.filter(
      (r): r is VoiceDecision =>
        r.gameId === meta.gameId && r.source === "voice",
    );
    return voicesForGame.at(-1) ?? null;
  }, [meta.gameId, recentDecisions]);

  return (
    <div className={styles.surface}>
      <section className={styles.left}>
        <div>
          <div className={styles.heroEyebrow}>Welcome back</div>
          <h1 className={styles.headline}>
            Ready for the
            <span className={styles.headlineAccent}> next game</span>.
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
            validating={matchesLoadingNow}
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
                  : "No matches yet"
            }
          />
          <StatBox
            label="Avg KDA"
            validating={matchesLoadingNow}
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
                  : "No matches yet"
            }
          />
          <StatBox
            label="Coaching moments"
            validating={decisionsLoadingNow}
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
          {meta.gameId !== null ? (
            <LastGameBlock
              meta={meta}
              snapshot={lastGame}
              lastVoice={lastVoice}
            />
          ) : (
            <p className={styles.lastGameStats}>No games yet.</p>
          )}
        </div>

        <div>
          <div className={styles.sectionLabel}>
            Recent games {matchesLoadingNow ? <LoadingDots /> : null}
          </div>
          <div className={styles.recent}>
            {recent.length === 0 ? (
              <p className={styles.recentEmpty}>
                {matchesLoadingNow
                  ? "Pulling recent matches…"
                  : "No matches in your client history yet."}
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
  /**
   * True while the underlying source is revalidating in the background.
   * Surfaces a small dots affordance next to the label so the user sees
   * that a refresh is happening even when the cached value is unchanged
   * (the value itself stays put — flickering it to "..." and back would
   * read as a glitch, not a confirmation).
   */
  validating?: boolean;
}

function StatBox({ label, value, delta, validating }: StatBoxProps) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statLabel}>
        {label}
        {validating ? <LoadingDots /> : null}
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statDelta}>{delta}</div>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className={styles.loadingDots} aria-label="Loading">
      <span aria-hidden="true">·</span>
      <span aria-hidden="true">·</span>
      <span aria-hidden="true">·</span>
    </span>
  );
}

interface LastGameBlockProps {
  /**
   * Merged metadata from match-history → decision-log takeaway → snapshot.
   * The visibility gate above guarantees `meta.gameId !== null`, so every
   * other field has at least one source — though some (e.g. duration on a
   * pre-takeaway, pre-history match) may still be null.
   */
  meta: LastGameMeta;
  /**
   * Optional in-memory snapshot for the just-finished game. Present
   * during the live session that produced the game; null after a
   * restart.
   */
  snapshot: LastGameSnapshot | null;
  /**
   * Most recent voice exchange for `meta.gameId`, derived from the
   * cached decision-log query. Used as the Q&A fallback when `snapshot`
   * is absent (e.g. cold launch with no live session yet).
   */
  lastVoice: VoiceDecision | null;
}

function LastGameBlock({ meta, snapshot, lastVoice }: LastGameBlockProps) {
  // Prefer the in-memory snapshot's most-recent exchange; fall back to
  // the cached decision-log voice record. Both carry the same shape.
  const exchange = snapshot?.recentExchanges[0] ?? lastVoice;
  const isWin = meta.isWin ?? false;
  const gameMode = formatGameMode(meta.gameMode);
  const championName = meta.championName ?? snapshot?.championName ?? "—";
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
          {meta.kills ?? snapshot?.kills ?? "—"} /{" "}
          {meta.deaths ?? snapshot?.deaths ?? "—"} /{" "}
          {meta.assists ?? snapshot?.assists ?? "—"}
        </span>
        <span>·</span>
        <span>{formatDuration(meta.duration ?? snapshot?.gameTime ?? 0)}</span>
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
