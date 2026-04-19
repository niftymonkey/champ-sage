import type {
  AnyFeedEntry,
  GamePlanEntry,
  AugmentOfferEntry,
  CoachingExchangeEntry,
} from "../../lib/reactive/coaching-feed-types";
import type { FitRating } from "../../lib/ai/types";
import { useCoachingContext } from "../../hooks/useCoachingContext";
import { AugmentCard } from "../AugmentCard";
import styles from "./CoachingCard.module.css";

interface CoachingCardProps {
  entry: AnyFeedEntry;
}

export function CoachingCard({ entry }: CoachingCardProps) {
  switch (entry.type) {
    case "game-plan":
      return <GamePlanCard entry={entry} />;
    case "augment-offer":
      return <AugmentOfferCard entry={entry} />;
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

/* ─── Augment Offer Card ─── */

function AugmentOfferCard({ entry }: { entry: AugmentOfferEntry }) {
  const { gameData } = useCoachingContext();

  return (
    <div
      className={`${styles.card} ${styles.proactive} ${styles.augmentOfferCard}`}
    >
      <CardHeader
        type="augment"
        label="Augment offer"
        timestamp={entry.timestamp}
      />
      <div className={styles.body}>
        <div className={styles.augmentOffer}>
          {entry.options.map((opt) => {
            const augment = gameData?.augments.get(opt.name.toLowerCase());
            return (
              <div
                key={opt.name}
                className={`${styles.augmentOption} ${opt.fit === "exceptional" || opt.fit === "strong" ? styles.augmentHighlight : ""}`}
              >
                <span
                  className={`${styles.augmentFitBadge} ${fitBadgeClass(opt.fit)}`}
                >
                  {fitLabel(opt.fit)}
                </span>
                {augment ? (
                  <AugmentCard augment={augment} />
                ) : (
                  <div className={styles.augmentName}>{opt.name}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Coaching Exchange Card ─── */

const SOURCE_LABELS: Record<CoachingExchangeEntry["source"], string> = {
  voice: "Voice query",
  augment: "Augment coaching",
  plan: "Game plan update",
};

function CoachingExchangeCard({ entry }: { entry: CoachingExchangeEntry }) {
  const label = SOURCE_LABELS[entry.source] ?? "Coaching";
  return (
    <div
      className={`${styles.card} ${entry.source !== "voice" ? styles.proactive : ""}`}
    >
      <CardHeader
        type={entry.source === "voice" ? "voice" : "augment"}
        label={label}
        timestamp={entry.timestamp}
      />
      <div className={styles.body}>
        <div className={styles.question}>{entry.question}</div>
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

function BuildPath({ items }: { items: string[] }) {
  return (
    <div className={styles.buildPath}>
      {items.map((item, i) => (
        <span key={`${item}-${i}`}>
          {i > 0 && <span className={styles.buildArrow}>→ </span>}
          <span className={styles.buildItem}>{item}</span>
        </span>
      ))}
    </div>
  );
}

const FIT_BADGE_CLASSES: Record<FitRating, string> = {
  exceptional: styles.badgeExceptional,
  strong: styles.badgeStrong,
  situational: styles.badgeSituational,
  weak: styles.badgeWeak,
};

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

function fitBadgeClass(fit: FitRating): string {
  return FIT_BADGE_CLASSES[fit];
}

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
