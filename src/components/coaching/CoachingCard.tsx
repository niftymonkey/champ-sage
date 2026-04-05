import type {
  AnyFeedEntry,
  GamePlanEntry,
  AugmentOfferEntry,
  VoiceCoachingEntry,
} from "../../lib/reactive/coaching-feed-types";
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
    case "voice-coaching":
      return <VoiceCoachingCard entry={entry} />;
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
  return (
    <div className={`${styles.card} ${styles.proactive}`}>
      <CardHeader
        type="augment"
        label="Augment offer"
        timestamp={entry.timestamp}
      />
      <div className={styles.body}>
        <div className={styles.augmentOffer}>
          {entry.options.map((opt) => (
            <div
              key={opt.name}
              className={`${styles.augmentOption} ${opt.rank === 1 ? styles.augmentPick : ""}`}
            >
              <span
                className={`${styles.augmentRankBadge} ${rankBadgeClass(opt.rank)}`}
              >
                {opt.rank}
              </span>
              <div className={styles.augmentName}>{opt.name}</div>
              <div className={styles.augmentReason}>{opt.reasoning}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Voice Coaching Card ─── */

function VoiceCoachingCard({ entry }: { entry: VoiceCoachingEntry }) {
  return (
    <div className={styles.card}>
      <CardHeader
        type="voice"
        label="Voice query"
        timestamp={entry.timestamp}
      />
      <div className={styles.body}>
        <div className={styles.question}>{entry.question}</div>
        <div className={styles.answer}>{entry.answer}</div>
        {entry.recommendations.length > 0 && (
          <div className={styles.recommendations}>
            {entry.recommendations.map((rec, i) => (
              <div key={rec.name} className={styles.recItem}>
                <span className={`${styles.recRank} ${rankClass(i + 1)}`}>
                  {i + 1}
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

function rankClass(rank: number): string {
  if (rank === 1) return styles.rank1;
  if (rank === 2) return styles.rank2;
  if (rank === 3) return styles.rank3;
  return "";
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return styles.badgeRank1;
  if (rank === 2) return styles.badgeRank2;
  if (rank === 3) return styles.badgeRank3;
  return "";
}

function formatGameTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
