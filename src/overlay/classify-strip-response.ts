/**
 * Decide what the coaching strip overlay should do with an incoming coaching
 * response, by source. Pure so the rules can be unit-tested without mounting
 * the overlay component or its RxJS streams.
 *
 * Order matters: augment-fit responses render on the separate badge overlay and
 * carry no `answer` for the strip, so they must be skipped BEFORE the no-answer
 * check. Otherwise every augment offer logs a spurious "no answer" warning.
 */
export interface StripResponseInput {
  source?: string;
  answer?: string;
  rev?: number;
}

export type StripAction =
  | { kind: "skip" }
  | { kind: "warn-no-answer" }
  | { kind: "plan"; rev: number; answer: string }
  | { kind: "voice"; answer: string };

export function classifyStripResponse(
  response: StripResponseInput
): StripAction {
  // Augment-fit responses live on the separate badge overlay window; skip them
  // before the no-answer guard so a missing `answer` does not warn.
  if (response.source === "augment") return { kind: "skip" };
  if (!response.answer) return { kind: "warn-no-answer" };
  if (response.source === "plan") {
    // Defaults to 1 when the sender omits rev (older payloads or non-plan
    // paths that misroute here).
    return { kind: "plan", rev: response.rev ?? 1, answer: response.answer };
  }
  // Voice, item-rec, and unknown sources all read as a coach voice answer.
  return { kind: "voice", answer: response.answer };
}
