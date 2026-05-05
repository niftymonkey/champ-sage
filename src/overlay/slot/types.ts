/**
 * The bottom-right overlay slot can show one of four state bodies at a time.
 * Each variant carries exactly the data its body needs - no shared payload
 * shape - so adding a new variant in the future is a closed-set change at
 * a single seam.
 *
 * Priority is encoded by the discriminant order, but enforcement lives in
 * the resolver, not the type. See `resolver.ts`.
 */

export interface VoiceAnswerPayload {
  /** The player's spoken question, rendered as italic Fraunces teal. */
  question: string;
  /** The coach's answer body. */
  answer: string;
  /** When the answer arrived (renderer wall-clock ms). */
  timestamp: number;
}

export interface PlanRevisionPayload {
  /** Sentence describing the pivot - "We pivoted from X to Y because...". */
  summary: string;
  /** Plan revision number. Display reads "Plan rev N" in the chip. */
  rev: number;
  timestamp: number;
}

export interface ThreatSpikePayload {
  /** Threat noun, e.g. "Veigar ult". Rendered front-loaded in --threat-hi. */
  threat: string;
  /** One-sentence "what to do" body. */
  reason: string;
  timestamp: number;
}

/**
 * What the slot host renders. `null` means the slot stays empty - the host
 * should render nothing (no card, no glass). The "empty" variant is a
 * deliberate visible card with the push-to-talk hint, distinct from
 * "show nothing at all".
 */
export type ActiveSlotItem =
  | { kind: "voice-resting"; payload: VoiceAnswerPayload; pinned: boolean }
  | { kind: "plan-revision"; payload: PlanRevisionPayload }
  | { kind: "threat-spike"; payload: ThreatSpikePayload }
  | { kind: "empty" };

/**
 * Numeric priorities the resolver uses for replacement decisions.
 * Higher number wins. Lower-priority arrivals during a higher-priority
 * card's dwell are queued (current behavior: only voice-resting can be
 * queued behind plan-revision; threat-spike replaces all and never queues).
 */
export const SLOT_PRIORITY = {
  empty: 0,
  "voice-resting": 1,
  "plan-revision": 2,
  "threat-spike": 3,
} as const;

export type SlotKind = keyof typeof SLOT_PRIORITY;
