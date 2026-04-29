import type {
  AnyFeedEntry,
  GamePlanEntry,
  CoachingExchangeEntry,
} from "../../lib/reactive/coaching-feed-types";
import type { BuildPathItem, FitRating } from "../../lib/ai/types";
import type { LoadedGameData } from "../../lib/data-ingest";
import { useCoachingContext } from "../../hooks/useCoachingContext";
import { BuildPathIcon, BUILD_PATH_CATEGORY_LABELS } from "./BuildPathIcon";
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
      <CardHeader type="plan" label="Game plan" timestamp={entry.timestamp} />
      <div className={styles.body}>
        <div className={styles.planSummary}>{entry.summary}</div>
        <BuildPath items={entry.buildPath} />
      </div>
    </div>
  );
}

/* ─── Coaching Exchange Card ─── */

const SOURCE_LABELS: Record<CoachingExchangeEntry["source"], string> = {
  voice: "Voice query",
  augment: "Augment coaching",
  plan: "Game plan update",
  "item-rec": "Item recommendation",
};

function CoachingExchangeCard({ entry }: { entry: CoachingExchangeEntry }) {
  const { gameData } = useCoachingContext();
  const label = SOURCE_LABELS[entry.source] ?? "Coaching";
  return (
    <div
      className={`${styles.card} ${entry.source !== "voice" ? styles.proactive : ""}`}
    >
      <CardHeader
        type={
          entry.source === "voice"
            ? "voice"
            : entry.source === "augment"
              ? "augment"
              : "plan"
        }
        label={label}
        timestamp={entry.timestamp}
      />
      <div className={styles.body}>
        {/* Only show the question text for player-initiated voice queries.
            Proactive sources (augment, plan, item-rec) synthesize a question
            string for the LLM internally; rendering it here would imply the
            player said it. */}
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
  if (!gameData) return null;
  // Items map is keyed by ID; linear scan by name is fine — ~200 entries,
  // 2-3 recs per render. Item.image is already a fully-resolved DDragon URL.
  let url: string | null = null;
  for (const item of gameData.items.values()) {
    if (item.name === name) {
      url = item.image;
      break;
    }
  }
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      className={styles.recItemIcon}
      loading="lazy"
    />
  );
}

/* ─── Shared subcomponents ─── */

type CardType = "plan" | "augment" | "voice";

interface CardHeaderProps {
  type: CardType;
  label: string;
  timestamp: number;
}

function CardHeader({ type, label, timestamp }: CardHeaderProps) {
  const dotClass = {
    plan: styles.dotPlan,
    augment: styles.dotAugment,
    voice: styles.dotVoice,
  }[type];

  return (
    <div className={styles.header}>
      <span className={styles.cardType}>
        <span className={`${styles.typeDot} ${dotClass}`} />
        {label}
      </span>
      <span>{formatGameTime(timestamp)}</span>
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
