import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import { createSlotResolver } from "./resolver";
import type {
  ActiveSlotItem,
  PlanRevisionPayload,
  ThreatSpikePayload,
  VoiceAnswerPayload,
} from "./types";

interface Harness {
  voiceAnswer$: Subject<VoiceAnswerPayload>;
  planRevision$: Subject<PlanRevisionPayload>;
  threatSpike$: Subject<ThreatSpikePayload>;
  emptyVisible$: BehaviorSubject<boolean>;
  dismiss$: Subject<void>;
  pin$: Subject<void>;
  emissions: Array<ActiveSlotItem | null>;
  unsubscribe: () => void;
}

function buildHarness(
  opts?: Parameters<typeof createSlotResolver>[1]
): Harness {
  const voiceAnswer$ = new Subject<VoiceAnswerPayload>();
  const planRevision$ = new Subject<PlanRevisionPayload>();
  const threatSpike$ = new Subject<ThreatSpikePayload>();
  const emptyVisible$ = new BehaviorSubject<boolean>(false);
  const dismiss$ = new Subject<void>();
  const pin$ = new Subject<void>();

  const slot$ = createSlotResolver(
    {
      voiceAnswer$,
      planRevision$,
      threatSpike$,
      emptyVisible$,
      dismiss$,
      pin$,
    },
    opts
  );

  const emissions: Array<ActiveSlotItem | null> = [];
  const sub = slot$.subscribe((item) => emissions.push(item));

  return {
    voiceAnswer$,
    planRevision$,
    threatSpike$,
    emptyVisible$,
    dismiss$,
    pin$,
    emissions,
    unsubscribe: () => sub.unsubscribe(),
  };
}

const VOICE_DWELL_MS = 30_000;
const PLAN_DWELL_MS = 8_000;
const THREAT_DWELL_MS = 6_000;

describe("createSlotResolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("idle / empty toggling", () => {
    it("starts with null when nothing is happening and empty is hidden", () => {
      const h = buildHarness();
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });

    it("emits the empty variant when emptyVisible$ flips to true", () => {
      const h = buildHarness();
      h.emptyVisible$.next(true);
      expect(h.emissions[h.emissions.length - 1]).toEqual({ kind: "empty" });
      h.unsubscribe();
    });

    it("returns to null when emptyVisible$ flips back to false", () => {
      const h = buildHarness();
      h.emptyVisible$.next(true);
      h.emptyVisible$.next(false);
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });
  });

  describe("voice-resting", () => {
    it("emits voice-resting when a voice answer arrives", () => {
      const h = buildHarness();
      h.voiceAnswer$.next({
        question: "rabadons next?",
        answer: "yes",
        timestamp: 0,
      });
      const last = h.emissions[h.emissions.length - 1];
      expect(last?.kind).toBe("voice-resting");
      h.unsubscribe();
    });

    it("auto-expires after the 30s dwell back to idle", () => {
      const h = buildHarness();
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 0 });
      vi.advanceTimersByTime(VOICE_DWELL_MS + 100);
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });

    it("does not auto-expire when pinned", () => {
      const h = buildHarness();
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 0 });
      h.pin$.next();
      vi.advanceTimersByTime(VOICE_DWELL_MS + 5_000);
      const last = h.emissions[h.emissions.length - 1];
      expect(last?.kind).toBe("voice-resting");
      if (last && last.kind === "voice-resting") {
        expect(last.pinned).toBe(true);
      }
      h.unsubscribe();
    });

    it("dismiss$ clears the active card", () => {
      const h = buildHarness();
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 0 });
      h.dismiss$.next();
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });

    it("a second voice answer replaces the first one", () => {
      const h = buildHarness();
      h.voiceAnswer$.next({ question: "first", answer: "a", timestamp: 0 });
      h.voiceAnswer$.next({ question: "second", answer: "b", timestamp: 1 });
      const last = h.emissions[h.emissions.length - 1];
      expect(last?.kind).toBe("voice-resting");
      if (last && last.kind === "voice-resting") {
        expect(last.payload.question).toBe("second");
      }
      h.unsubscribe();
    });
  });

  describe("plan-revision", () => {
    it("emits plan-revision when a revision arrives", () => {
      const h = buildHarness();
      h.planRevision$.next({ summary: "pivot", rev: 2, timestamp: 0 });
      const last = h.emissions[h.emissions.length - 1];
      expect(last?.kind).toBe("plan-revision");
      h.unsubscribe();
    });

    it("auto-expires after the 8s dwell back to idle", () => {
      const h = buildHarness();
      h.planRevision$.next({ summary: "x", rev: 2, timestamp: 0 });
      vi.advanceTimersByTime(PLAN_DWELL_MS + 100);
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });

    it("replaces an active voice-resting (higher priority wins)", () => {
      const h = buildHarness();
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 0 });
      h.planRevision$.next({ summary: "pivot", rev: 2, timestamp: 1 });
      const last = h.emissions[h.emissions.length - 1];
      expect(last?.kind).toBe("plan-revision");
      h.unsubscribe();
    });

    it("does NOT restore the prior voice-resting when it expires", () => {
      // Per spec: "When the higher one dismisses, the lower one does NOT
      // come back - the slot returns to default behavior (most likely
      // empty / hidden)."
      const h = buildHarness();
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 0 });
      h.planRevision$.next({ summary: "pivot", rev: 2, timestamp: 1 });
      vi.advanceTimersByTime(PLAN_DWELL_MS + 100);
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });

    it("queues a voice answer that arrives during a plan-revision", () => {
      // Lower priority cannot replace higher, but the player asked
      // something - show it after plan-rev expires.
      const h = buildHarness();
      h.planRevision$.next({ summary: "pivot", rev: 2, timestamp: 0 });
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 1 });
      // While plan-rev still showing
      expect(h.emissions[h.emissions.length - 1]?.kind).toBe("plan-revision");
      // After plan-rev expires
      vi.advanceTimersByTime(PLAN_DWELL_MS + 100);
      expect(h.emissions[h.emissions.length - 1]?.kind).toBe("voice-resting");
      h.unsubscribe();
    });
  });

  describe("threat-spike", () => {
    it("is suppressed by default while the Riot policy gate is open", () => {
      // suppressThreatSpike defaults to true. Threat events fire but never
      // surface to the slot.
      const h = buildHarness();
      h.threatSpike$.next({
        threat: "Veigar ult",
        reason: "stay back",
        timestamp: 0,
      });
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });

    it("emits threat-spike when suppression is disabled, replacing all lower priorities", () => {
      const h = buildHarness({ suppressThreatSpike: false });
      h.voiceAnswer$.next({ question: "?", answer: "!", timestamp: 0 });
      h.planRevision$.next({ summary: "pivot", rev: 2, timestamp: 1 });
      h.threatSpike$.next({
        threat: "Veigar ult",
        reason: "stay back",
        timestamp: 2,
      });
      expect(h.emissions[h.emissions.length - 1]?.kind).toBe("threat-spike");
      h.unsubscribe();
    });

    it("auto-expires after the 6s dwell when enabled", () => {
      const h = buildHarness({ suppressThreatSpike: false });
      h.threatSpike$.next({ threat: "x", reason: "y", timestamp: 0 });
      vi.advanceTimersByTime(THREAT_DWELL_MS + 100);
      expect(h.emissions[h.emissions.length - 1]).toBeNull();
      h.unsubscribe();
    });
  });
});
