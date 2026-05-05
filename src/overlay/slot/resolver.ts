import { BehaviorSubject, Observable, Subscription } from "rxjs";
import { distinctUntilChanged } from "rxjs/operators";
import type {
  ActiveSlotItem,
  PlanRevisionPayload,
  ThreatSpikePayload,
  VoiceAnswerPayload,
} from "./types";
import { SLOT_PRIORITY } from "./types";

/**
 * Inputs the resolver needs to compute the active slot item. All are
 * observables so the resolver can be tested headlessly with Subjects, and
 * the wiring (mapping from existing app streams to these payloads) lives
 * at the call site instead of being baked into the resolver.
 */
export interface SlotResolverInputs {
  /** Coach answered a player voice question. */
  voiceAnswer$: Observable<VoiceAnswerPayload>;
  /** Coach revised the build plan mid-game. */
  planRevision$: Observable<PlanRevisionPayload>;
  /** Threat-spike detector fired. Phase 4 ships with this typed but
   *  suppressed at runtime per the Phase 0 policy gate. */
  threatSpike$: Observable<ThreatSpikePayload>;
  /** Whether the empty/prompt body should currently be visible. */
  emptyVisible$: Observable<boolean>;
  /** User clicked the active card to dismiss it. */
  dismiss$: Observable<void>;
  /** User long-pressed the active card to pin it (voice-resting only). */
  pin$: Observable<void>;
}

export interface SlotResolverOptions {
  /**
   * When true, the threat-spike variant is suppressed even if its input
   * stream emits. Default true while the Riot policy gate is open. Setting
   * false unlocks priority=3 without any other code changes.
   */
  suppressThreatSpike?: boolean;
  /** Per-state dwell durations. Override only in tests. */
  dwellMs?: Partial<
    Record<"voice-resting" | "plan-revision" | "threat-spike", number>
  >;
}

const DEFAULT_DWELL_MS: Record<
  "voice-resting" | "plan-revision" | "threat-spike",
  number
> = {
  "voice-resting": 30_000,
  "plan-revision": 8_000,
  "threat-spike": 6_000,
};

/**
 * Internal state shape. The active variant (or "idle") plus the queued
 * voice-resting payload (when a voice answer arrived during a higher-
 * priority card and should appear once that card expires).
 */
type ResolverState =
  | { kind: "idle" }
  | { kind: "voice-resting"; payload: VoiceAnswerPayload; pinned: boolean }
  | { kind: "plan-revision"; payload: PlanRevisionPayload }
  | { kind: "threat-spike"; payload: ThreatSpikePayload };

/**
 * Build the activeSlot$ observable from the input streams.
 *
 * The resolver is a small reducer over four kinds of events (voice answer
 * arrived, plan revision arrived, threat-spike arrived, dismiss/pin). Per-
 * state dwell timers are scheduled with setTimeout against the host clock;
 * tests use vi.useFakeTimers to drive them.
 *
 * Invariants:
 *   - Higher-priority arrivals replace lower-priority active cards.
 *   - When a higher-priority card dismisses, the prior lower one does NOT
 *     restore - the slot returns to idle (which then renders empty if
 *     emptyVisible$ is true).
 *   - A voice answer arriving while plan-revision is showing is queued and
 *     emitted when plan-revision expires.
 */
export function createSlotResolver(
  inputs: SlotResolverInputs,
  options: SlotResolverOptions = {}
): Observable<ActiveSlotItem | null> {
  const dwell = { ...DEFAULT_DWELL_MS, ...(options.dwellMs ?? {}) };
  const suppressThreat = options.suppressThreatSpike ?? true;

  return new Observable<ActiveSlotItem | null>((subscriber) => {
    let state: ResolverState = { kind: "idle" };
    let queuedVoice: VoiceAnswerPayload | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEmptyVisible = false;

    const cancelDwell = (): void => {
      if (dwellTimer !== null) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    };

    const emit = (): void => {
      const item: ActiveSlotItem | null =
        state.kind === "idle"
          ? lastEmptyVisible
            ? { kind: "empty" }
            : null
          : state.kind === "voice-resting"
            ? {
                kind: "voice-resting",
                payload: state.payload,
                pinned: state.pinned,
              }
            : state.kind === "plan-revision"
              ? { kind: "plan-revision", payload: state.payload }
              : { kind: "threat-spike", payload: state.payload };
      subscriber.next(item);
    };

    const expireToIdle = (): void => {
      cancelDwell();
      // If a voice answer was queued behind the just-expired card, surface
      // it now. Per spec, lower-priority arrivals during a higher card are
      // queued; only voice during plan-rev is the case we exercise today.
      if (queuedVoice) {
        const payload = queuedVoice;
        queuedVoice = null;
        state = { kind: "voice-resting", payload, pinned: false };
        scheduleDwell();
      } else {
        state = { kind: "idle" };
      }
      emit();
    };

    const scheduleDwell = (): void => {
      cancelDwell();
      if (state.kind === "idle") return;
      if (state.kind === "voice-resting" && state.pinned) return;
      const ms = dwell[state.kind];
      dwellTimer = setTimeout(expireToIdle, ms);
    };

    const enter = (next: ResolverState): void => {
      state = next;
      scheduleDwell();
      emit();
    };

    const subs = new Subscription();

    subs.add(
      inputs.voiceAnswer$.subscribe((payload) => {
        const currentPriority = SLOT_PRIORITY[stateKindForPriority(state)];
        const incomingPriority = SLOT_PRIORITY["voice-resting"];
        if (incomingPriority >= currentPriority) {
          // Same priority (replacing prior voice-resting) or higher than
          // the current card. Take the slot, drop any queued voice.
          queuedVoice = null;
          enter({ kind: "voice-resting", payload, pinned: false });
        } else {
          // A higher-priority card is showing - queue this one to surface
          // when the current card expires.
          queuedVoice = payload;
        }
      })
    );

    subs.add(
      inputs.planRevision$.subscribe((payload) => {
        const currentPriority = SLOT_PRIORITY[stateKindForPriority(state)];
        const incomingPriority = SLOT_PRIORITY["plan-revision"];
        if (incomingPriority >= currentPriority) {
          enter({ kind: "plan-revision", payload });
        }
        // Plan-revision arriving under threat-spike is dropped today.
        // Spec calls for queueing; threat-spike is deferred so this is
        // unreachable in practice. Revisit when threat-spike unlocks.
      })
    );

    subs.add(
      inputs.threatSpike$.subscribe((payload) => {
        if (suppressThreat) return;
        // Threat-spike is the highest priority; always replaces.
        queuedVoice = null;
        enter({ kind: "threat-spike", payload });
      })
    );

    subs.add(
      inputs.dismiss$.subscribe(() => {
        if (state.kind === "idle") return;
        cancelDwell();
        queuedVoice = null;
        state = { kind: "idle" };
        emit();
      })
    );

    subs.add(
      inputs.pin$.subscribe(() => {
        if (state.kind !== "voice-resting") return;
        state = { ...state, pinned: true };
        cancelDwell();
        emit();
      })
    );

    subs.add(
      inputs.emptyVisible$.pipe(distinctUntilChanged()).subscribe((visible) => {
        lastEmptyVisible = visible;
        // Empty visibility only matters when the slot is idle - active
        // cards override it regardless. Re-emit so subscribers see the
        // empty/null toggle.
        if (state.kind === "idle") emit();
      })
    );

    // Initial emission so subscribers immediately see the starting state.
    emit();

    return () => {
      cancelDwell();
      subs.unsubscribe();
    };
  });
}

/**
 * Map the internal state to the priority key used in SLOT_PRIORITY. Idle
 * is treated as the lowest tier for replacement-decision purposes.
 */
function stateKindForPriority(
  state: ResolverState
): keyof typeof SLOT_PRIORITY {
  return state.kind === "idle" ? "empty" : state.kind;
}

/**
 * Helper for callers that want a hot, replay-on-subscribe shape. Wraps the
 * resolver in a BehaviorSubject so late subscribers see the latest item.
 */
export function shareSlotResolver(source: Observable<ActiveSlotItem | null>): {
  activeSlot$: BehaviorSubject<ActiveSlotItem | null>;
  teardown: () => void;
} {
  const activeSlot$ = new BehaviorSubject<ActiveSlotItem | null>(null);
  const sub = source.subscribe(activeSlot$);
  return {
    activeSlot$,
    teardown: () => sub.unsubscribe(),
  };
}
