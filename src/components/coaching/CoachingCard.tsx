import type {
  AnyFeedEntry,
  GamePlanEntry,
  CoachingExchangeEntry,
} from "../../lib/reactive/coaching-feed-types";
import type { BuildPathItem, FitRating } from "../../lib/ai/types";
import type { LoadedGameData } from "../../lib/data-ingest";
import { useCoachingContext } from "../../hooks/useCoachingContext";
import { BuildPathIcon, BUILD_PATH_CATEGORY_LABELS } from "./BuildPathIcon";
import { ItemIcon as SharedItemIcon } from "../items/ItemIcon";
import styles from "./CoachingCard.module.css";

interface CoachingCardProps {
  entry: AnyFeedEntry;
}

export function CoachingCard({ entry }: CoachingCardProps) {
  switch (entry.type) {
    case "game-plan":
      return <GamePlanCard entry={entry} />;
    case "coaching-exchange":
      return <CoachingExchangeCard entry={entry} />;
  }
}

/* ─── Game Plan Card ─── */

function GamePlanCard({ entry }: { entry: GamePlanEntry }) {
  return (
    <div className={`${styles.card} ${styles.proactive}`}>
      <CardHeader subtype="game plan" timestamp={entry.timestamp} />
      <div className={styles.body}>
        <div className={styles.planSummary}>{entry.summary}</div>
        <BuildPath items={entry.buildPath} />
      </div>
    </div>
  );
}

/* ─── Coaching Exchange Card ─── */

/**
 * Sub-type strings follow the v16 spec's vocabulary: every card reads as
 * "coach · {sub-type}" so the player knows whether the turn was theirs or
 * proactive. "answering you · via voice" mirrors the empty/prompt overlay's
 * Hold-to-ask language. Proactive sources collapse to "on observation" - the
 * coach noticed something and chose to speak.
 */
const SOURCE_SUBTYPES: Record<CoachingExchangeEntry["source"], string> = {
  voice: "answering you · via voice",
  augment: "on observation",
  plan: "on observation",
  "item-rec": "on observation",
};

function CoachingExchangeCard({ entry }: { entry: CoachingExchangeEntry }) {
  const { gameData } = useCoachingContext();
  const subtype = SOURCE_SUBTYPES[entry.source] ?? "on observation";
  return (
    <div
      className={`${styles.card} ${entry.source !== "voice" ? styles.proactive : ""}`}
    >
      <CardHeader subtype={subtype} timestamp={entry.timestamp} />
      <div className={styles.body}>
        {/* Voice exchanges read as a single turn: the player's question is
            rendered above the coach's answer in italic Fraunces teal, the
            coach's answer in italic Fraunces warm-bone. Proactive sources
            (augment / plan / item-rec) synthesize a question string for the
            LLM internally - we don't surface it because the player did not
            actually say it. */}
        {entry.source === "voice" && (
          <div className={styles.question}>{entry.question}</div>
        )}
        {entry.retried && (
          <div
            className={styles.retriedBadge}
            title="LLM returned malformed output on first attempt; this response is from the automatic retry."
          >
            ↻ retried
          </div>
        )}
        <div className={styles.answer}>{entry.answer}</div>
        {entry.recommendations.length > 0 && (
          <div className={styles.recommendations}>
            {entry.recommendations.map((rec) => (
              <div key={rec.name} className={styles.recItem}>
                <span className={`${styles.recFit} ${fitTextClass(rec.fit)}`}>
                  {fitLabel(rec.fit)}
                </span>
                <ItemIcon name={rec.name} gameData={gameData} />
                <div>
                  <div className={styles.recName}>{rec.name}</div>
                  <div className={styles.recReason}>{rec.reasoning}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Item icon — small DDragon thumbnail beside each recommendation row ─── */

function ItemIcon({
  name,
  gameData,
}: {
  name: string;
  gameData: LoadedGameData | null;
}) {
  return (
    <SharedItemIcon
      name={name}
      gameData={gameData}
      className={styles.recItemIcon}
      title={null}
      // Existing card uses a token-tuned 3.55rem; SharedItemIcon's
      // numeric size prop is ignored when className supplies its own
      // dimensions, but pass through a sane default in case the
      // class omits sizing in some future restyle.
      size={56}
    />
  );
}

/* ─── Shared subcomponents ─── */

interface CardHeaderProps {
  /** Subtype string after the leading "coach" keyword, e.g. "answering you · via voice". */
  subtype: string;
  timestamp: number;
}

function CardHeader({ subtype, timestamp }: CardHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.cardType}>
        <span className={styles.cardTypeKeyword}>coach</span>
        <span className={styles.cardTypeSep}>·</span>
        <span>{subtype}</span>
      </span>
      <span className={styles.timestamp}>{formatGameTime(timestamp)}</span>
    </div>
  );
}

function BuildPath({ items }: { items: BuildPathItem[] }) {
  return (
    <div className={styles.buildPath}>
      {items.map((item, i) => (
        <span
          key={`${item.name}-${i}`}
          className={styles.buildItemWrap}
          title={formatBuildItemTooltip(item)}
        >
          {i > 0 && <span className={styles.buildArrow}>→ </span>}
          <BuildPathIcon
            category={item.category}
            className={`${styles.buildItemIcon} ${styles[`cat_${item.category}`] ?? ""}`}
          />
          <span className={styles.buildItem}>{item.name}</span>
        </span>
      ))}
    </div>
  );
}

function formatBuildItemTooltip(item: BuildPathItem): string {
  const label = BUILD_PATH_CATEGORY_LABELS[item.category];
  const header =
    item.category === "counter" && item.targetEnemy
      ? `${label} — ${item.targetEnemy}`
      : label;
  return item.reason ? `${header}: ${item.reason}` : header;
}

const FIT_TEXT_CLASSES: Record<FitRating, string> = {
  exceptional: styles.fitExceptional,
  strong: styles.fitStrong,
  situational: styles.fitSituational,
  weak: styles.fitWeak,
};

const FIT_LABELS: Record<FitRating, string> = {
  exceptional: "Exceptional",
  strong: "Strong",
  situational: "Situational",
  weak: "Weak",
};

function fitTextClass(fit: FitRating): string {
  return FIT_TEXT_CLASSES[fit];
}

function fitLabel(fit: FitRating): string {
  return FIT_LABELS[fit];
}

function formatGameTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
