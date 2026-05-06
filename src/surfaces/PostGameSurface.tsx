import { Fragment, useMemo } from "react";
import { useDecisionLogQuery } from "../hooks/useDecisionLogQuery";
import { useLastGameSnapshot } from "../hooks/useLastGameSnapshot";
import { useMatchHistory } from "../hooks/useMatchHistory";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { mergeMeta } from "../hooks/useLastGameMeta";
import { ItemIcon } from "../components/items/ItemIcon";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import type {
  AugmentDecision,
  DecisionRecord,
  PlanDecision,
  TakeawayDecision,
  VoiceDecision,
} from "../lib/decision-log/types";
import type { MatchSummary } from "../lib/match-history/types";
import { formatGameMode } from "../lib/format-game-mode";
import styles from "./PostGameSurface.module.css";

const LAST_GAME_QUERY = { kind: "last-game" } as const;

interface PostGameSurfaceProps {
  /**
   * Specific Riot gameId to render. When null, the surface shows the
   * just-finished game via the `last-game` query — used by auto-routing
   * (game ended) and direct nav to the post-game tab. When a string,
   * the surface queries that specific match — used when the user
   * clicks a row in the IdleSurface recent-games list.
   */
  gameId?: string | null;
}
/**
 * How long after the game ends to keep showing "writing the recap" before
 * switching to a factual fallback headline. Matches the typical LLM
 * post-game-takeaway latency (a couple of seconds) plus generous slack.
 */
const RECAP_PENDING_WINDOW_MS = 30_000;

/**
 * Post-game surface — render the just-finished game from the decision log.
 * Two-column layout per the v16 spec:
 *   Left  — eyebrow + headline + narrative + stat trio + build/plan recap
 *   Right — coach-side timeline mini-chart + final build list
 *
 * Single source of truth: the most recent takeaway record (game state +
 * narrative) plus the rest of the game's decision-log slice (timeline +
 * conversation). When no takeaway exists yet (in-flight LLM call or a
 * zero-coach game), a calm pending state shows.
 */
export function PostGameSurface({ gameId = null }: PostGameSurfaceProps = {}) {
  const query = useMemo(
    () => (gameId ? { kind: "by-game" as const, gameId } : LAST_GAME_QUERY),
    [gameId]
  );
  const { summary, loading, error } = useDecisionLogQuery(query);
  const snapshot = useLastGameSnapshot();
  const { recentGames, matches } = useMatchHistory();
  // For the auto-routed "last game" view, the most-recent match-history
  // row is the authoritative source. For a specific gameId (clicked
  // from the recent-games list), find that exact match.
  const authoritativeMatch = useMemo(() => {
    if (gameId) return matches.find((m) => m.gameId === gameId);
    return recentGames(1)[0];
  }, [gameId, matches, recentGames]);

  if (!loading && summary.totalCount === 0) {
    // No records for this query. Two reasons we end up here:
    // 1. Nothing has been played yet — fall back to the welcome copy.
    // 2. The user clicked an older row in Recent games whose records
    //    were written before the renderer started using the Riot
    //    gameId (everything pre-this-feature). Those rows are
    //    permanently orphaned from coach data; tell the user plainly.
    const headline = gameId
      ? "No coach data for this match."
      : "Honest about what we both did.";
    const body = gameId
      ? "This match was played before per-game coach history shipped, so there's nothing to show. Newer matches will fill out fully."
      : "No completed game yet this session. Once a match wraps, the recap and conversation log land here.";
    return (
      <div className={styles.surface}>
        <section className={styles.left}>
          <div className={styles.eyebrow}>
            <span>Post-game</span>
          </div>
          <h1 className={styles.headline}>{headline}</h1>
          <p className={styles.empty}>{body}</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.surface}>
      <LeftColumn
        takeaway={summary.takeaway}
        planRevisions={summary.byKind.plan.length}
        finalPlan={summary.finalPlan}
        voices={summary.byKind.voice}
        snapshot={snapshot}
        authoritativeMatch={authoritativeMatch}
        endedAt={summary.endedAt}
        error={error}
      />
      <RightColumn
        authoritativeMatch={authoritativeMatch}
        takeaway={summary.takeaway}
        finalPlan={summary.finalPlan}
        startedAt={summary.startedAt}
        endedAt={summary.endedAt}
        voices={summary.byKind.voice}
        plans={summary.byKind.plan}
        augments={summary.byKind.augment}
        itemRecs={summary.byKind.itemRec}
        allRecords={[
          ...summary.byKind.voice,
          ...summary.byKind.plan,
          ...summary.byKind.augment,
          ...summary.byKind.itemRec,
        ]}
      />
    </div>
  );
}

interface LeftColumnProps {
  takeaway: TakeawayDecision | null;
  planRevisions: number;
  finalPlan: PlanDecision | null;
  voices: VoiceDecision[];
  snapshot: LastGameSnapshot | null;
  authoritativeMatch: MatchSummary | undefined;
  endedAt: number | null;
  error: Error | null;
}

function LeftColumn({
  takeaway,
  planRevisions,
  finalPlan,
  voices,
  snapshot,
  authoritativeMatch,
  endedAt,
  error,
}: LeftColumnProps) {
  // Single source of truth for the merged metadata (champion, KDA,
  // mode, win/loss, etc.) — see useLastGameMeta. Match-history wins,
  // then takeaway, then snapshot.
  const meta = mergeMeta(authoritativeMatch, takeaway, snapshot);
  const champion = meta.championName;

  // The takeaway can take a few seconds to land. Show the "writing"
  // copy only inside that window; after that, switch to a factual
  // fallback so the page doesn't claim to be in flight forever.
  const recapStillPending =
    endedAt !== null && Date.now() - endedAt < RECAP_PENDING_WINDOW_MS;

  return (
    <section className={styles.left}>
      <div className={styles.headerBlock}>
        {takeaway ? (
          <h1 className={styles.headline}>
            Three takeaways from{" "}
            <span className={styles.headlineAccent}>{champion}</span>.
          </h1>
        ) : champion ? (
          <h1 className={styles.headline}>
            Match recap for{" "}
            <span className={styles.headlineAccent}>{champion}</span>.
          </h1>
        ) : (
          <h1 className={styles.headline}>Match recap.</h1>
        )}
        {takeaway ? (
          <Narrative text={takeaway.narrative} />
        ) : recapStillPending ? (
          <p className={styles.narrativePending}>
            The coach is writing the recap…
          </p>
        ) : null}
      </div>

      <div className={styles.statTrio}>
        <StatBox
          label="Length"
          value={
            takeaway
              ? formatDuration(takeaway.duration)
              : snapshot
                ? formatDuration(snapshot.gameTime)
                : "—"
          }
        />
        <StatBox
          label="KDA"
          value={
            takeaway
              ? `${takeaway.kills} / ${takeaway.deaths} / ${takeaway.assists}`
              : snapshot
                ? `${snapshot.kills} / ${snapshot.deaths} / ${snapshot.assists}`
                : "—"
          }
        />
        <StatBox
          label="Largest spree"
          value={
            authoritativeMatch
              ? String(authoritativeMatch.largestKillingSpree)
              : "—"
          }
        />
      </div>

      <BuildSection
        takeaway={takeaway}
        planRevisions={planRevisions}
        finalPlan={finalPlan}
      />

      <ConversationBlock voices={voices} />

      {error ? (
        <p className={styles.empty}>
          Couldn&apos;t load decision log: {error.message}
        </p>
      ) : null}
    </section>
  );
}

interface BuildSectionProps {
  takeaway: TakeawayDecision | null;
  planRevisions: number;
  finalPlan: PlanDecision | null;
}

function BuildSection({
  takeaway,
  planRevisions,
  finalPlan,
}: BuildSectionProps) {
  const { gameData } = useCoachingContext();
  const items: string[] =
    takeaway?.recommendedBuild ?? finalPlan?.buildPath.map((b) => b.name) ?? [];
  const total = items.length;
  let summaryText: string;
  if (total === 0) {
    summaryText = "No initial build path was generated for this match.";
  } else if (takeaway) {
    const matched = takeaway.matchedItemCount;
    summaryText =
      matched === total
        ? `You ended up with every item from the coach's initial path (${matched} of ${total}).`
        : matched === 0
          ? `None of the ${total} items from the coach's initial path made it into your final build.`
          : `You finished with ${matched} of ${total} items from the coach's initial path.`;
  } else {
    summaryText = `Coach recommended a ${total}-item opening build path. Final build will populate once the takeaway lands.`;
  }

  return (
    <div className={styles.buildSection}>
      <div className={styles.buildHeader}>
        <span className={styles.buildHeaderLeft}>Initial build path</span>
        <span className={styles.buildHeaderLeft}>
          {planRevisions === 0
            ? "no plan recorded"
            : `${planRevisions} ${planRevisions === 1 ? "revision" : "revisions"}`}
        </span>
      </div>
      <p className={styles.buildAlignmentSummary}>{summaryText}</p>
      {items.length > 0 ? (
        <div className={styles.buildPathRow}>
          {items.map((name, i) => (
            <Fragment key={`${name}-${i}`}>
              {i > 0 ? (
                <span className={styles.buildPathArrow} aria-hidden="true">
                  →
                </span>
              ) : null}
              <ItemIcon
                name={name}
                gameData={gameData}
                size={40}
                className={styles.buildPathIcon}
              />
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface RightColumnProps {
  takeaway: TakeawayDecision | null;
  finalPlan: PlanDecision | null;
  startedAt: number | null;
  endedAt: number | null;
  voices: VoiceDecision[];
  plans: PlanDecision[];
  augments: AugmentDecision[];
  itemRecs: DecisionRecord[];
  allRecords: DecisionRecord[];
  authoritativeMatch: MatchSummary | undefined;
}

function RightColumn({
  takeaway,
  finalPlan,
  startedAt,
  endedAt,
  voices,
  plans,
  augments,
  itemRecs,
  allRecords,
  authoritativeMatch,
}: RightColumnProps) {
  // Eyebrow lives over here so the left column's headline ("Match recap
  // for X.") is the first thing the eye lands on top-left. Win / mode
  // come from the same merged source the left column uses.
  const meta = mergeMeta(authoritativeMatch, takeaway, null);
  const gameMode = meta.gameMode ? formatGameMode(meta.gameMode) : null;
  const result = meta.isWin === null ? null : meta.isWin ? "victory" : "defeat";
  const resultClass = meta.isWin
    ? styles.eyebrowResultWin
    : styles.eyebrowResultLoss;
  return (
    <aside className={styles.right}>
      <div className={styles.eyebrow}>
        <span>Post-game</span>
        {result !== null ? (
          <>
            <span>·</span>
            <span className={resultClass}>{result.toUpperCase()}</span>
          </>
        ) : null}
        {gameMode ? (
          <>
            <span>·</span>
            <span>{gameMode}</span>
          </>
        ) : null}
      </div>
      <div className={styles.timelineCard}>
        <h2 className={styles.timelineTitle}>Coach-side timeline</h2>
        <Timeline
          startedAt={startedAt}
          endedAt={endedAt}
          records={allRecords}
        />
        <div className={styles.timelineLegend}>
          <LegendRow color="var(--accent)" label="Plans" count={plans.length} />
          <LegendRow color="var(--quote)" label="Voice" count={voices.length} />
          <LegendRow
            color="var(--fit-strong)"
            label="Augments"
            count={augments.length}
          />
          <LegendRow
            color="var(--fit-excellent)"
            label="Items"
            count={itemRecs.length}
          />
        </div>
      </div>

      <FinalBuildSection
        takeaway={takeaway}
        finalPlan={finalPlan}
        authoritativeMatch={authoritativeMatch}
      />
    </aside>
  );
}

function LegendRow({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <span>
      <span
        className={styles.timelineLegendDot}
        style={{ background: color }}
      />
      {label} <span className={styles.timelineLegendCount}>{count}</span>
    </span>
  );
}

interface TimelineProps {
  startedAt: number | null;
  endedAt: number | null;
  records: DecisionRecord[];
}

function Timeline({ startedAt, endedAt, records }: TimelineProps) {
  if (
    startedAt === null ||
    endedAt === null ||
    records.length === 0 ||
    endedAt <= startedAt
  ) {
    return (
      <div className={styles.timelineChart}>
        <span className={styles.timelineEmpty}>No timeline yet.</span>
      </div>
    );
  }
  const span = endedAt - startedAt;
  return (
    <div className={styles.timelineChart}>
      {records.map((r) => {
        const pct = ((r.sentAt - startedAt) / span) * 100;
        const cls =
          r.source === "plan"
            ? styles.timelineTickPlan
            : r.source === "voice"
              ? styles.timelineTickVoice
              : r.source === "augment"
                ? styles.timelineTickAugment
                : r.source === "item-rec"
                  ? styles.timelineTickItemRec
                  : styles.timelineTickPlan;
        return (
          <span
            key={r.id}
            className={`${styles.timelineTick} ${cls}`}
            style={{ left: `calc(${Math.max(0, Math.min(100, pct))}% - 1px)` }}
            title={r.source}
          />
        );
      })}
    </div>
  );
}

interface FinalBuildSectionProps {
  takeaway: TakeawayDecision | null;
  finalPlan: PlanDecision | null;
  authoritativeMatch: MatchSummary | undefined;
}

function FinalBuildSection({
  takeaway,
  finalPlan,
  authoritativeMatch,
}: FinalBuildSectionProps) {
  const { gameData } = useCoachingContext();
  const recommended =
    takeaway?.recommendedBuild ?? finalPlan?.buildPath.map((b) => b.name) ?? [];
  // Source priority: takeaway record (LLM-stamped at game-end) →
  // match-history (server-authoritative, fills in when eogStats was
  // null and the takeaway captured an empty list).
  const finalItems =
    takeaway?.finalItems && takeaway.finalItems.length > 0
      ? takeaway.finalItems
      : (authoritativeMatch?.finalItems ?? []);
  const matched =
    takeaway && takeaway.finalItems.length > 0
      ? takeaway.matchedItemCount
      : finalItems.filter((n) => recommended.includes(n)).length;
  const totalRecommended = recommended.length;
  const recommendedSet = new Set(recommended);

  // Show only what the player actually ended with. Each row gets an
  // "On plan" tag if it appears in the coach's initial build path;
  // otherwise no tag (a deliberate purchase off-plan is information,
  // not noise). Items the coach recommended but the player never
  // bought live in the left column's Initial Build Path block.
  if (finalItems.length === 0) {
    return (
      <div className={styles.finalBuildSection}>
        <div className={styles.finalBuildHeader}>
          <h2 className={styles.finalBuildTitle}>Your final build</h2>
        </div>
        <p className={styles.empty}>
          {takeaway
            ? "No items captured for this match."
            : "Final items will populate once the takeaway lands."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.finalBuildSection}>
      <div className={styles.finalBuildHeader}>
        <h2 className={styles.finalBuildTitle}>Your final build</h2>
        {totalRecommended > 0 ? (
          <span className={styles.finalBuildMeta}>
            {matched} / {totalRecommended} matched plan
          </span>
        ) : null}
      </div>
      <div className={styles.finalBuildList}>
        {finalItems.map((name) => {
          const onPlan = recommendedSet.has(name);
          return (
            <div key={name} className={styles.finalBuildRow}>
              <span className={styles.finalBuildIconWrap}>
                <ItemIcon
                  name={name}
                  gameData={gameData}
                  size={28}
                  className={styles.finalBuildIcon}
                />
              </span>
              <span className={styles.finalBuildName}>{name}</span>
              {onPlan ? (
                <span
                  className={`${styles.finalBuildTag} ${styles.finalBuildTagOnPlan}`}
                >
                  On plan
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ConversationBlockProps {
  voices: VoiceDecision[];
}

function ConversationBlock({ voices }: ConversationBlockProps) {
  if (voices.length === 0) {
    return (
      <div className={styles.conversation}>
        <span className={styles.conversationTitle}>Conversation</span>
        <p className={styles.empty}>
          You didn&apos;t ask the coach anything this game.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.conversation}>
      <span className={styles.conversationTitle}>
        Conversation · {voices.length} {voices.length === 1 ? "turn" : "turns"}{" "}
        woven
      </span>
      <div className={styles.conversationList}>
        {voices.map((v) => (
          <article key={v.id} className={styles.exchange}>
            {v.question ? (
              <p className={styles.exchangeQuestion}>
                <RichText text={v.question} />
              </p>
            ) : null}
            <p className={styles.exchangeAnswer}>
              <RichText text={v.answer} />
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

interface StatBoxProps {
  label: string;
  value: string;
}

function StatBox({ label, value }: StatBoxProps) {
  return (
    <div className={styles.statBox}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

/**
 * Render markdown-italic emphasis (single-asterisk pairs) in the
 * narrative. Anything between `*...*` becomes italic+oxblood; the rest
 * is plain Fraunces. We don't run a full markdown parser — just this one
 * convention the prompt opts into.
 */
function Narrative({ text }: { text: string }) {
  return (
    <p className={styles.narrative}>
      <RichText text={text} emClassName={styles.narrativeEm} />
    </p>
  );
}

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "bold"; text: string };

/**
 * Render `**bold**` and `*italic*` inline emphasis from LLM output.
 * Strips `++…++` markers (some prompts emit them; not standard
 * markdown). Does not handle headings, links, code — this is just
 * inline emphasis for prose. Used by the takeaway narrative AND the
 * post-game conversation answers so both render the same way.
 */
function RichText({
  text,
  emClassName,
  strongClassName,
}: {
  text: string;
  emClassName?: string;
  strongClassName?: string;
}) {
  const tokens = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "italic") {
          return (
            <em key={i} className={emClassName}>
              {t.text}
            </em>
          );
        }
        if (t.kind === "bold") {
          return (
            <strong key={i} className={strongClassName}>
              {t.text}
            </strong>
          );
        }
        return <Fragment key={i}>{t.text}</Fragment>;
      })}
    </>
  );
}

function parseInline(input: string): InlineToken[] {
  // Strip the non-standard ++…++ markers some prompts emit.
  const text = input.replace(/\+\+([^+]+)\+\+/g, "$1");
  const out: InlineToken[] = [];
  // Match **bold** OR *italic* (bold first because ** is a superset).
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", text: text.slice(last, m.index) });
    }
    if (m[0].startsWith("**")) {
      out.push({ kind: "bold", text: m[0].slice(2, -2) });
    } else {
      out.push({ kind: "italic", text: m[0].slice(1, -1) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", text: text.slice(last) });
  }
  return out;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
