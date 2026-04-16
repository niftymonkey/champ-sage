import type { CoachingResponse } from "../lib/ai/types";
import { ThinkingIndicator } from "./ThinkingIndicator";

/** Strip markdown bold/italic markers from LLM output */
function stripMarkdown(text: string): string {
  return text.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
}

/**
 * Card position ratios derived from calibration screenshots at
 * 2560x1440, 1920x1080, and 1600x900. Cards scale proportionally.
 */
const CARD_POSITIONS = {
  /** Y position of badges (fraction of screen height, above card titles) */
  badgeY: 0.095,
  /** X centers of the three cards (fraction of screen width) */
  cardCenters: [0.315, 0.5, 0.685],
  /** Badge width (fraction of screen width) */
  badgeWidth: 0.14,
};

interface AugmentBadgesProps {
  offer: string[] | null;
  coaching: CoachingResponse | null;
}

/**
 * Renders rank badges above each augment/stat anvil card during an offer.
 * Shows a "thinking" indicator while waiting for coaching response,
 * then shows ranked badges once the response arrives.
 */
export function AugmentBadges({ offer, coaching }: AugmentBadgesProps) {
  if (!offer) return null;

  // Match coaching recommendations to offer positions by name. Slots whose
  // augment name is in the coaching response get a ranked Badge; slots whose
  // name is absent (a rerolled-in card waiting for new coaching) get a
  // ThinkingIndicator. This lets kept cards stay on screen during a reroll
  // while only the changed slot briefly shows "analyzing." (#98)
  const rankMap = new Map<string, { rank: number; reasoning: string }>();
  coaching?.recommendations.forEach((rec, i) => {
    rankMap.set(rec.name.toLowerCase(), {
      rank: i + 1,
      reasoning: rec.reasoning,
    });
  });

  return (
    <>
      {offer.map((name, i) => {
        const match = rankMap.get(name.toLowerCase());

        if (!match) {
          const cx = CARD_POSITIONS.cardCenters[i];
          return (
            <ThinkingIndicator
              key={`loading-${i}`}
              top={`${CARD_POSITIONS.badgeY * 100}vh`}
              left={`${cx * 100}vw`}
              transform="translateX(-50%)"
              width={`${CARD_POSITIONS.badgeWidth * 100}vw`}
              height={100}
            />
          );
        }

        return (
          <Badge
            key={`badge-${i}`}
            rank={match.rank}
            reason={stripMarkdown(match.reasoning)}
            slotIndex={i}
          />
        );
      })}
    </>
  );
}

interface BadgeProps {
  rank: number;
  reason: string;
  slotIndex: number;
}

const RANK_COLORS: Record<number, string> = {
  1: "#22c55e", // green — best pick
  2: "#eab308", // yellow — second
  3: "#ef4444", // red — worst
};

function Badge({ rank, reason, slotIndex }: BadgeProps) {
  const centerX = CARD_POSITIONS.cardCenters[slotIndex];
  const bgColor = RANK_COLORS[rank] ?? "rgba(100, 100, 100, 0.8)";

  return (
    <div
      style={{
        position: "fixed",
        top: `${CARD_POSITIONS.badgeY * 100}vh`,
        left: `${centerX * 100}vw`,
        transform: "translateX(-50%)",
        width: `${CARD_POSITIONS.badgeWidth * 100}vw`,
        height: 100,
        pointerEvents: "none",
        zIndex: 9000,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderRadius: 6,
        padding: "4px 6px",
        border: `2px solid ${bgColor}`,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          float: "left",
          backgroundColor: bgColor,
          color: "#fff",
          borderRadius: 3,
          padding: "1px 6px",
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: 13,
          lineHeight: 1,
          marginRight: 4,
          marginTop: 1,
        }}
      >
        {rank}
      </span>
      <span
        style={{
          color: "#ddd",
          fontSize: 17,
          fontFamily: "monospace",
          lineHeight: 1.3,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
        }}
      >
        {reason}
      </span>
    </div>
  );
}
