/**
 * Coach decision log types — the shape of records the log persists, the
 * shape of queries readers issue, and the shape of the per-game summary
 * the renderer renders.
 *
 * Records use a tagged union keyed on `source` so each variant carries
 * exactly the fields that make sense for it. Common envelope fields
 * (`id`, `gameId`, `gameMode`, `sentAt`, `retried`, `schemaVersion`) live
 * on every variant via the `DecisionEnvelope` intersection.
 */

import type { BuildPathItem, Recommendation } from "../ai/types";

export type DecisionSource =
  | "voice"
  | "plan"
  | "augment"
  | "item-rec"
  | "threat-spike";

export type DecisionGameMode =
  | "ARAM"
  | "CLASSIC"
  | "CHERRY"
  | "PRACTICETOOL"
  | "OTHER";

/**
 * Fields every decision record carries regardless of source. Schema version
 * lets storage adapters migrate older shapes forward when fields evolve.
 */
export interface DecisionEnvelope {
  id: string;
  gameId: string;
  gameMode: DecisionGameMode;
  sentAt: number;
  retried: boolean;
  schemaVersion: 1;
}

export interface VoiceDecision extends DecisionEnvelope {
  source: "voice";
  question: string;
  answer: string;
}

export interface PlanDecision extends DecisionEnvelope {
  source: "plan";
  answer: string;
  buildPath: BuildPathItem[];
  rev: number;
}

export interface AugmentDecision extends DecisionEnvelope {
  source: "augment";
  question: string;
  recommendations: Recommendation[];
}

export interface ItemRecDecision extends DecisionEnvelope {
  source: "item-rec";
  question: string;
  answer: string;
  recommendations: Recommendation[];
}

export interface ThreatSpikeDecision extends DecisionEnvelope {
  source: "threat-spike";
  threat: string;
  reason: string;
}

export type DecisionRecord =
  | VoiceDecision
  | PlanDecision
  | AugmentDecision
  | ItemRecDecision
  | ThreatSpikeDecision;

/**
 * Input shape passed to `append`. The log assigns `id`, `sentAt`, and
 * `schemaVersion`; callers provide everything else.
 */
export type DecisionInput =
  | Omit<VoiceDecision, "id" | "sentAt" | "schemaVersion">
  | Omit<PlanDecision, "id" | "sentAt" | "schemaVersion">
  | Omit<AugmentDecision, "id" | "sentAt" | "schemaVersion">
  | Omit<ItemRecDecision, "id" | "sentAt" | "schemaVersion">
  | Omit<ThreatSpikeDecision, "id" | "sentAt" | "schemaVersion">;

/**
 * Query shapes the log answers. Each variant is closed-set; new readers
 * grow the union rather than adding new methods.
 */
export type DecisionQuery =
  | { kind: "by-game"; gameId: string }
  | { kind: "last-game" }
  | { kind: "recent-games"; n: number }
  | { kind: "by-source"; gameId: string; source: DecisionSource };

/**
 * Per-game summary the renderer can hand to its components without further
 * shaping. Built by `summarizeGame(records)`.
 */
export interface GameSummary {
  gameId: string | null;
  gameMode: DecisionGameMode | null;
  startedAt: number | null;
  endedAt: number | null;
  byKind: {
    voice: VoiceDecision[];
    plan: PlanDecision[];
    augment: AugmentDecision[];
    itemRec: ItemRecDecision[];
    threatSpike: ThreatSpikeDecision[];
  };
  finalPlan: PlanDecision | null;
  retriedCount: number;
  totalCount: number;
}

export interface RecoveryWarning {
  gameId: string;
  droppedLines: number;
  reason: string;
}
