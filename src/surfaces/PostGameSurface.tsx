import { Fragment, useMemo } from "react";
import { useDecisionLogQuery } from "../hooks/useDecisionLogQuery";
import type {
  AugmentDecision,
  DecisionRecord,
  PlanDecision,
  TakeawayDecision,
  VoiceDecision,
} from "../lib/decision-log/types";
import styles from "./PostGameSurface.module.css";

const LAST_GAME_QUERY = { kind: "last-game" } as const;

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
export function PostGameSurface() {
  const { summary, loading, error } = useDecisionLogQuery(LAST_GAME_QUERY);

  if (!loading && summary.totalCount === 0) {
    return (
      <div className={styles.surface}>
        <section className={styles.left}>
          <div className={styles.eyebrow}>
            <span>04</span>
            <span>·</span>
            <span>Post-game</span>
          </div>
          <h1 className={styles.headline}>Honest about what we both did.</h1>
          <p className={styles.empty}>
            No completed game yet this session. Once a match wraps, the recap
            and conversation log land here.
          </p>
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
        error={error}
      />
      <RightColumn
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
  error: Error | null;
}

function LeftColumn({
  takeaway,
  planRevisions,
  finalPlan,
  voices,
  error,
}: LeftColumnProps) {
  const champion = takeaway?.champion ?? "—";
  const result = takeaway?.isWin ? "victory" : takeaway ? "defeat" : "—";
  const resultClass = takeaway?.isWin
    ? styles.eyebrowResultWin
    : styles.eyebrowResultLoss;

  return (
    <section className={styles.left}>
      <div className={styles.eyebrow}>
        <span>04</span>
        <span>·</span>
        <span>Post-game</span>
        {takeaway ? (
          <>
            <span>·</span>
            <span className={resultClass}>{result.toUpperCase()}</span>
            <span>·</span>
            <span>{takeaway.gameMode || "—"}</span>
          </>
        ) : null}
      </div>

      <div>
        {takeaway ? (
          <h1 className={styles.headline}>
            Three takeaways from{" "}
            <span className={styles.headlineAccent}>{champion}</span>.
          </h1>
        ) : (
          <h1 className={styles.headline}>The coach is writing the recap.</h1>
        )}
        {takeaway ? <Narrative text={takeaway.narrative} /> : null}
      </div>

      <div className={styles.statTrio}>
        <StatBox
          label="Length"
          value={takeaway ? formatDuration(takeaway.duration) : "—"}
        />
        <StatBox
          label="KDA"
          value={
            takeaway
              ? `${takeaway.kills} / ${takeaway.deaths} / ${takeaway.assists}`
              : "—"
          }
        />
        <StatBox
          label="Final gold"
          value={
            takeaway?.finalGold !== null && takeaway?.finalGold !== undefined
              ? takeaway.finalGold.toLocaleString()
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
  const matched = takeaway?.matchedItemCount ?? 0;
  const total =
    takeaway?.recommendedBuild.length ?? finalPlan?.buildPath.length ?? 0;
  const summaryText =
    !takeaway || total === 0
      ? "No coach-recommended build was generated for this match."
      : matched === total
        ? `You bought every item the coach recommended (${matched} of ${total}).`
        : matched === 0
          ? `None of the ${total} coach-recommended items made it into the final build.`
          : `You bought ${matched} of ${total} items the coach recommended.`;

  return (
    <div className={styles.buildSection}>
      <div className={styles.buildHeader}>
        <span className={styles.buildHeaderLeft}>Build · followed plan</span>
        <span className={styles.buildHeaderLeft}>
          {planRevisions === 0
            ? "no plan recorded"
            : `${planRevisions} ${planRevisions === 1 ? "revision" : "revisions"}`}
        </span>
      </div>
      <p className={styles.buildAlignmentSummary}>{summaryText}</p>
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
}: RightColumnProps) {
  return (
    <aside className={styles.right}>
      <div className={styles.timelineCard}>
        <div className={styles.timelineHeader}>
          <h2 className={styles.timelineTitle}>Coach-side timeline</h2>
          <span className={styles.timelineCounts}>decisions · questions</span>
        </div>
        <div className={styles.timelineHeader}>
          <span className={styles.timelineSubtitle}>
            What the coach did, when
          </span>
          <span className={styles.timelineCounts}>
            {plans.length} plan revs · {voices.length} voice turns ·{" "}
            {augments.length} augments · {itemRecs.length} item recs
          </span>
        </div>
        <Timeline
          startedAt={startedAt}
          endedAt={endedAt}
          records={allRecords}
        />
        <div className={styles.timelineLegend}>
          <span>
            <span
              className={styles.timelineLegendDot}
              style={{ background: "var(--accent)" }}
            />
            Coach decision
          </span>
          <span>
            <span
              className={styles.timelineLegendDot}
              style={{ background: "var(--quote)" }}
            />
            Your voice
          </span>
          <span>
            <span
              className={styles.timelineLegendDot}
              style={{ background: "var(--fit-strong)" }}
            />
            Augment pick
          </span>
          <span>
            <span
              className={styles.timelineLegendDot}
              style={{ background: "var(--fit-excellent)" }}
            />
            Item rec
          </span>
        </div>
      </div>

      <FinalBuildSection takeaway={takeaway} finalPlan={finalPlan} />
    </aside>
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
}

function FinalBuildSection({ takeaway, finalPlan }: FinalBuildSectionProps) {
  const recommended =
    takeaway?.recommendedBuild ?? finalPlan?.buildPath.map((b) => b.name) ?? [];
  const finalItems = takeaway?.finalItems ?? [];
  const matched = takeaway?.matchedItemCount ?? 0;
  const totalRecommended = recommended.length;
  const recommendedSet = new Set(recommended);

  // Render: every item the player ended with, then any recommended items
  // that weren't bought (dimmed). Tags: ON PLAN (item appears in both
  // lists); RECOMMENDED (in plan only). Items in finalItems that aren't
  // recommended get no tag.
  const builtRows = finalItems.map((name) => ({
    name,
    inFinal: true,
    onPlan: recommendedSet.has(name),
  }));
  const builtSet = new Set(finalItems);
  const missedRows = recommended
    .filter((n) => !builtSet.has(n))
    .map((name) => ({ name, inFinal: false, onPlan: true }));
  const rows = [...builtRows, ...missedRows];

  if (rows.length === 0) {
    return (
      <div className={styles.finalBuildSection}>
        <div className={styles.finalBuildHeader}>
          <h2 className={styles.finalBuildTitle}>Your final build</h2>
        </div>
        <p className={styles.empty}>No final items captured.</p>
      </div>
    );
  }

  return (
    <div className={styles.finalBuildSection}>
      <div className={styles.finalBuildHeader}>
        <h2 className={styles.finalBuildTitle}>Your final build</h2>
        {totalRecommended > 0 ? (
          <span className={styles.finalBuildMeta}>
            {matched} / {totalRecommended} from EOG block
          </span>
        ) : null}
      </div>
      <div className={styles.finalBuildList}>
        {rows.map((row) => (
          <div
            key={row.name}
            className={`${styles.finalBuildRow} ${row.inFinal ? "" : styles.finalBuildRowDimmed}`}
          >
            <span className={styles.finalBuildName}>{row.name}</span>
            {row.inFinal && row.onPlan ? (
              <span
                className={`${styles.finalBuildTag} ${styles.finalBuildTagOnPlan}`}
              >
                On plan
              </span>
            ) : !row.inFinal ? (
              <span
                className={`${styles.finalBuildTag} ${styles.finalBuildTagRecommended}`}
              >
                Recommended
              </span>
            ) : null}
          </div>
        ))}
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
              <p className={styles.exchangeQuestion}>{v.question}</p>
            ) : null}
            <p className={styles.exchangeAnswer}>{v.answer}</p>
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
  const parts = useMemo(() => splitItalics(text), [text]);
  return (
    <p className={styles.narrative}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.italic ? (
            <em className={styles.narrativeEm}>{part.text}</em>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </p>
  );
}

function splitItalics(text: string): Array<{ text: string; italic: boolean }> {
  const out: Array<{ text: string; italic: boolean }> = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ text: text.slice(last, m.index), italic: false });
    }
    out.push({ text: m[1], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ text: text.slice(last), italic: false });
  }
  return out;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
