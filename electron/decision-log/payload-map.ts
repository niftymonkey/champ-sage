import type {
  DecisionGameMode,
  DecisionInput,
} from "../../src/lib/decision-log/types";

/**
 * Shape of the coaching-response IPC payload sent by the renderer's
 * sendCoachingResponse(). Defined here as the surface the log reads
 * from — the renderer constructs object literals matching this shape.
 *
 * `source` "reactive" is treated as voice/item-rec; the renderer marks
 * item-rec proactive paths with question text so we can disambiguate
 * if needed, but for log purposes "reactive" without a question still
 * counts as a voice exchange (the player triggered it).
 */
export interface CoachingResponsePayload {
  source: "plan" | "augment" | "reactive" | "item-rec" | "takeaway";
  answer: string;
  gameId?: string;
  gameMode?: string;
  question?: string;
  recommendations?: Array<{
    name: string;
    fit: "exceptional" | "strong" | "situational" | "weak";
    reasoning: string;
  }>;
  buildPath?: Array<{
    name: string;
    category: string;
    targetEnemy: string | null;
    reason: string;
  }> | null;
  rev?: number;
  retried?: boolean;
  sentAt?: number;
  // Takeaway-only fields (source: "takeaway")
  narrative?: string;
  champion?: string;
  isWin?: boolean;
  duration?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  finalGold?: number | null;
  finalItems?: string[];
  recommendedBuild?: string[];
  matchedItemCount?: number;
}

const KNOWN_MODES: DecisionGameMode[] = [
  "ARAM",
  "CLASSIC",
  "CHERRY",
  "PRACTICETOOL",
];

function normalizeGameMode(raw: string | undefined): DecisionGameMode {
  if (!raw) return "OTHER";
  const upper = raw.toUpperCase();
  if (upper.includes("ARAM")) return "ARAM";
  if (upper.includes("PRACTICE")) return "PRACTICETOOL";
  if (upper.includes("CHERRY") || upper === "ARENA") return "CHERRY";
  if (upper === "CLASSIC" || upper === "SUMMONERS_RIFT") return "CLASSIC";
  return KNOWN_MODES.includes(upper as DecisionGameMode)
    ? (upper as DecisionGameMode)
    : "OTHER";
}

/**
 * Convert a coaching-response IPC payload into a DecisionInput suitable
 * for `log.append()`. Returns null when the payload is missing fields the
 * log needs (gameId, recognized source) — main logs the drop and moves on.
 */
export function coachingPayloadToDecisionInput(
  payload: CoachingResponsePayload
): DecisionInput | null {
  if (!payload?.gameId) return null;

  const envelope = {
    gameId: payload.gameId,
    gameMode: normalizeGameMode(payload.gameMode),
    retried: payload.retried === true,
  };

  switch (payload.source) {
    case "plan":
      return {
        ...envelope,
        source: "plan",
        answer: payload.answer ?? "",
        buildPath: (payload.buildPath ?? []).map((b) => ({
          name: b.name,
          category: b.category as
            | "core"
            | "counter"
            | "defensive"
            | "damage"
            | "utility"
            | "situational",
          targetEnemy: b.targetEnemy,
          reason: b.reason,
        })),
        rev: typeof payload.rev === "number" ? payload.rev : 1,
      };

    case "augment":
      return {
        ...envelope,
        source: "augment",
        question: payload.question ?? "",
        recommendations: payload.recommendations ?? [],
      };

    case "item-rec":
      return {
        ...envelope,
        source: "item-rec",
        question: payload.question ?? "",
        answer: payload.answer ?? "",
        recommendations: payload.recommendations ?? [],
      };

    case "reactive": {
      // The renderer routes both voice answers and item-rec proactive
      // responses through source="reactive". For log purposes both are
      // recorded as voice exchanges — the question text disambiguates
      // them visually downstream if needed.
      return {
        ...envelope,
        source: "voice",
        question: payload.question ?? "",
        answer: payload.answer ?? "",
      };
    }

    case "takeaway":
      return {
        ...envelope,
        source: "takeaway",
        narrative: payload.narrative ?? "",
        champion: payload.champion ?? "",
        isWin: payload.isWin === true,
        duration: typeof payload.duration === "number" ? payload.duration : 0,
        kills: typeof payload.kills === "number" ? payload.kills : 0,
        deaths: typeof payload.deaths === "number" ? payload.deaths : 0,
        assists: typeof payload.assists === "number" ? payload.assists : 0,
        finalGold:
          typeof payload.finalGold === "number" ? payload.finalGold : null,
        finalItems: payload.finalItems ?? [],
        recommendedBuild: payload.recommendedBuild ?? [],
        matchedItemCount:
          typeof payload.matchedItemCount === "number"
            ? payload.matchedItemCount
            : 0,
      };

    default:
      return null;
  }
}
