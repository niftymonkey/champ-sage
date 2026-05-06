import { useDecisionLogQuery } from "../hooks/useDecisionLogQuery";
import { useLastGameSnapshot } from "../hooks/useLastGameSnapshot";
import type {
  AugmentDecision,
  PlanDecision,
  VoiceDecision,
} from "../lib/decision-log/types";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import styles from "./PostGameSurface.module.css";

const LAST_GAME_QUERY = { kind: "last-game" } as const;

/**
 * Post-game surface — render the just-finished game from the decision log
 * + the in-memory last-game snapshot. Snapshot supplies the header
 * (champion, KDA, result, duration) since it's captured at game-end with
 * eogStats in scope; the log supplies the conversation, plan revisions,
 * and augment ratings since they survive restart.
 *
 * Surfaces empty states at every level so the user sees something
 * coherent even when the most recent game emitted no coaching activity.
 */
export function PostGameSurface() {
  const snapshot = useLastGameSnapshot();
  const { summary, loading, error } = useDecisionLogQuery(LAST_GAME_QUERY);

  if (!snapshot && !loading && summary.totalCount === 0) {
    return (
      <div className={styles.surface}>
        <Header snapshot={null} retriedCount={0} />
        <p className={styles.empty}>
          No completed game yet this session. Once a match wraps, the recap and
          conversation log land here.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.surface}>
      <Header snapshot={snapshot} retriedCount={summary.retriedCount} />

      <PlanRecapSection
        finalPlan={summary.finalPlan}
        revisionCount={summary.byKind.plan.length}
      />

      <ConversationSection voices={summary.byKind.voice} />

      <AugmentsSection augments={summary.byKind.augment} />

      {error ? (
        <p className={styles.empty}>
          Couldn't load decision log: {error.message}
        </p>
      ) : null}
    </div>
  );
}

interface HeaderProps {
  snapshot: LastGameSnapshot | null;
  retriedCount: number;
}

function Header({ snapshot, retriedCount }: HeaderProps) {
  if (!snapshot) {
    return (
      <header className={styles.header}>
        <span className={styles.eyebrow}>Post game</span>
        <h1 className={styles.headline}>Honest about what we both did.</h1>
      </header>
    );
  }
  const result = snapshot.isWin ? "victory" : "defeat";
  return (
    <header className={styles.header}>
      <span className={styles.eyebrow}>Post game</span>
      <h1 className={styles.headline}>
        {snapshot.championName}
        <span className={styles.headlineAccent}> · {result}</span>
      </h1>
      <div className={styles.statRow}>
        <span>
          {snapshot.kills} / {snapshot.deaths} / {snapshot.assists}
        </span>
        <span>·</span>
        <span>{formatDuration(snapshot.gameTime)}</span>
        <span>·</span>
        <span>{snapshot.gameMode || "—"}</span>
        {retriedCount > 0 ? (
          <>
            <span>·</span>
            <span>{retriedCount} silent retries</span>
          </>
        ) : null}
      </div>
    </header>
  );
}

interface PlanRecapSectionProps {
  finalPlan: PlanDecision | null;
  revisionCount: number;
}

function PlanRecapSection({ finalPlan, revisionCount }: PlanRecapSectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionLabel}>Game plan</span>
        <span className={styles.sectionMeta}>
          {revisionCount > 0
            ? `${revisionCount} ${revisionCount === 1 ? "revision" : "revisions"}`
            : "no plan recorded"}
        </span>
      </div>
      {finalPlan ? (
        <div className={styles.planRecap}>
          <p className={styles.planSummary}>{finalPlan.answer}</p>
          {finalPlan.buildPath.length > 0 ? (
            <p className={styles.planBuild}>
              {finalPlan.buildPath.map((b) => b.name).join(" → ")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className={styles.empty}>
          No game plan was generated for this match.
        </p>
      )}
    </section>
  );
}

interface ConversationSectionProps {
  voices: VoiceDecision[];
}

function ConversationSection({ voices }: ConversationSectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionLabel}>Conversation</span>
        <span className={styles.sectionMeta}>
          {voices.length === 0
            ? "no questions asked"
            : `${voices.length} ${voices.length === 1 ? "turn" : "turns"} woven`}
        </span>
      </div>
      {voices.length === 0 ? (
        <p className={styles.empty}>
          You didn't ask the coach anything this game.
        </p>
      ) : (
        <div className={styles.exchanges}>
          {voices.map((v) => (
            <article key={v.id} className={styles.exchange}>
              {v.question ? (
                <p className={styles.exchangeQuestion}>{v.question}</p>
              ) : null}
              <p className={styles.exchangeAnswer}>{v.answer}</p>
              {v.retried ? (
                <span className={styles.exchangeMeta}>silent retry</span>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

interface AugmentsSectionProps {
  augments: AugmentDecision[];
}

function AugmentsSection({ augments }: AugmentsSectionProps) {
  // One augment record per offer; flatten the recommendations so the user
  // sees the rating against each option rather than a record-per-offer list.
  const allRows = augments.flatMap((a) =>
    a.recommendations.map((r) => ({
      key: `${a.id}-${r.name}`,
      name: r.name,
      fit: r.fit,
      reasoning: r.reasoning,
    }))
  );

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionLabel}>Augment ratings</span>
        <span className={styles.sectionMeta}>
          {augments.length === 0
            ? "no offers seen"
            : `${augments.length} ${augments.length === 1 ? "offer" : "offers"}`}
        </span>
      </div>
      {allRows.length === 0 ? (
        <p className={styles.empty}>No augment offers were rated this game.</p>
      ) : (
        <div className={styles.augments}>
          {allRows.map((row) => (
            <div key={row.key} className={styles.augmentRow}>
              <span className={styles.augmentName}>{row.name}</span>
              <span className={styles.augmentReason}>{row.reasoning}</span>
              <span
                className={`${styles.augmentFit} ${fitClass(row.fit, styles)}`}
              >
                {row.fit}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function fitClass(
  fit: "exceptional" | "strong" | "situational" | "weak",
  s: typeof styles
): string {
  switch (fit) {
    case "exceptional":
      return s.fitExceptional;
    case "strong":
      return s.fitStrong;
    case "situational":
      return s.fitSituational;
    case "weak":
      return s.fitWeak;
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
