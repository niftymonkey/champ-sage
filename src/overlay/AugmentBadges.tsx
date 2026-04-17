import type { CoachingResponse, FitRating } from "../lib/ai/types";
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
 * Renders fit-rating badges above each augment/stat anvil card during an offer.
 * Shows a "thinking" indicator while waiting for coaching response,
 * then shows rated badges once the response arrives.
 */
export function AugmentBadges({ offer, coaching }: AugmentBadgesProps) {
  if (!offer) return null;

  // Match coaching recommendations to offer positions by name. Slots whose
  // augment name is in the coaching response get a rated Badge; slots whose
  // name is absent (a rerolled-in card waiting for new coaching) get a
  // ThinkingIndicator. This lets kept cards stay on screen during a reroll
  // while only the changed slot briefly shows "analyzing." (#98)
  const fitMap = new Map<string, { fit: FitRating; reasoning: string }>();
  coaching?.recommendations.forEach((rec) => {
    fitMap.set(rec.name.toLowerCase(), {
      fit: rec.fit,
      reasoning: rec.reasoning,
    });
  });

  return (
    <>
      <style>{PRISMATIC_KEYFRAMES}</style>
      {offer.map((name, i) => {
        const match = fitMap.get(name.toLowerCase());

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
            fit={match.fit}
            reason={stripMarkdown(match.reasoning)}
            slotIndex={i}
          />
        );
      })}
    </>
  );
}

interface BadgeProps {
  fit: FitRating;
  reason: string;
  slotIndex: number;
}

const FIT_COLORS: Record<FitRating, string> = {
  exceptional: "#b388ff", // prismatic base (overridden by gradient)
  strong: "#22c55e",
  situational: "#eab308",
  weak: "#6b7280",
};

const FIT_LABELS: Record<FitRating, string> = {
  exceptional: "Exceptional",
  strong: "Strong",
  situational: "Situational",
  weak: "Weak",
};

const PRISMATIC_GRADIENT =
  "linear-gradient(135deg, #ff80ab, #82b1ff, #b388ff, #80cbc4, #fff59d, #ff80ab)";

const PRISMATIC_KEYFRAMES = `
@keyframes prismatic-shift {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
`;

function Badge({ fit, reason, slotIndex }: BadgeProps) {
  const centerX = CARD_POSITIONS.cardCenters[slotIndex];
  const isPrismatic = fit === "exceptional";
  const borderColor = FIT_COLORS[fit];

  const borderStyle: React.CSSProperties = isPrismatic
    ? {
        borderImage: `${PRISMATIC_GRADIENT} 1`,
        borderWidth: 2,
        borderStyle: "solid",
      }
    : { border: `2px solid ${borderColor}` };

  const labelStyle: React.CSSProperties = isPrismatic
    ? {
        background: PRISMATIC_GRADIENT,
        backgroundSize: "200% 100%",
        animation: "prismatic-shift 3s linear infinite",
        color: "#0a0c10",
      }
    : {
        backgroundColor: borderColor,
        color: fit === "weak" ? "#e5e7eb" : "#fff",
      };

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
        padding: "16px 6px 4px",
        ...borderStyle,
      }}
    >
      {/* Fit label — centered at top, overlapping the border */}
      <span
        style={{
          position: "absolute",
          top: -9,
          left: "50%",
          transform: "translateX(-50%)",
          borderRadius: 3,
          padding: "1px 8px",
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: 13,
          lineHeight: "16px",
          whiteSpace: "nowrap",
          zIndex: 1,
          ...labelStyle,
        }}
      >
        {FIT_LABELS[fit]}
      </span>
      <div
        style={{
          overflow: "hidden",
          height: "100%",
        }}
      >
        <span
          style={{
            color: "#ddd",
            fontSize: 14,
            fontFamily: "monospace",
            lineHeight: 1.3,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 5,
            WebkitBoxOrient: "vertical",
          }}
        >
          {reason}
        </span>
      </div>
    </div>
  );
}
