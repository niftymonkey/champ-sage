import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Subject } from "rxjs";
import { createEmptyVisibility } from "./emptyVisibility";

interface Harness {
  gameStarted$: Subject<void>;
  pttPressed$: Subject<void>;
  voiceAnswer$: Subject<void>;
  planRevision$: Subject<void>;
  threatSpike$: Subject<void>;
  hasLearnedPtt: ReturnType<typeof vi.fn>;
  emissions: boolean[];
  unsubscribe: () => void;
}

function buildHarness(
  opts?: Parameters<typeof createEmptyVisibility>[1]
): Harness {
  const gameStarted$ = new Subject<void>();
  const pttPressed$ = new Subject<void>();
  const voiceAnswer$ = new Subject<void>();
  const planRevision$ = new Subject<void>();
  const threatSpike$ = new Subject<void>();
  const hasLearnedPtt = vi.fn(() => false);

  const visible$ = createEmptyVisibility(
    {
      gameStarted$,
      pttPressed$,
      voiceAnswer$,
      planRevision$,
      threatSpike$,
      hasLearnedPtt,
    },
    opts
  );

  const emissions: boolean[] = [];
  const sub = visible$.subscribe((v) => emissions.push(v));

  return {
    gameStarted$,
    pttPressed$,
    voiceAnswer$,
    planRevision$,
    threatSpike$,
    hasLearnedPtt,
    emissions,
    unsubscribe: () => sub.unsubscribe(),
  };
}

const SHOW_ON_START_MS = 30_000;
const SILENCE_MS = 5 * 60_000;

describe("createEmptyVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts hidden", () => {
    const h = buildHarness();
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    h.unsubscribe();
  });

  it("shows for the first 30s of a new game session", () => {
    const h = buildHarness();
    h.gameStarted$.next();
    expect(h.emissions[h.emissions.length - 1]).toBe(true);

    vi.advanceTimersByTime(SHOW_ON_START_MS - 100);
    expect(h.emissions[h.emissions.length - 1]).toBe(true);

    vi.advanceTimersByTime(200);
    expect(h.emissions[h.emissions.length - 1]).toBe(false);

    h.unsubscribe();
  });

  it("hides immediately on first push-to-talk press", () => {
    const h = buildHarness();
    h.gameStarted$.next();
    h.pttPressed$.next();
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    h.unsubscribe();
  });

  it("does not auto-show again after a PTT press in the same session", () => {
    // Once the player has used PTT this session, even >5min of silence
    // does not re-show the prompt.
    const h = buildHarness();
    h.gameStarted$.next();
    h.pttPressed$.next();
    vi.advanceTimersByTime(SILENCE_MS + 1_000);
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    h.unsubscribe();
  });

  it("any coach activity hides the empty card and resets the silence clock", () => {
    const h = buildHarness();
    h.gameStarted$.next();
    h.voiceAnswer$.next();
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    h.unsubscribe();
  });

  it("re-shows after >5min of overlay silence when the player has not learned PTT", () => {
    const h = buildHarness();
    h.gameStarted$.next();
    // Walk past the initial 30s teach window.
    vi.advanceTimersByTime(SHOW_ON_START_MS + 100);
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    // Now sit silent for 5 minutes - empty should re-show.
    vi.advanceTimersByTime(SILENCE_MS + 100);
    expect(h.emissions[h.emissions.length - 1]).toBe(true);
    h.unsubscribe();
  });

  it("does NOT re-show after silence when the lifetime PTT-learned flag is true", () => {
    const h = buildHarness();
    h.hasLearnedPtt.mockReturnValue(true);
    h.gameStarted$.next();
    // Player who already learned PTT skips the teach window entirely.
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    vi.advanceTimersByTime(SHOW_ON_START_MS + SILENCE_MS + 1_000);
    expect(h.emissions[h.emissions.length - 1]).toBe(false);
    h.unsubscribe();
  });

  it("activity within the teach window cuts the show short", () => {
    const h = buildHarness();
    h.gameStarted$.next();
    expect(h.emissions[h.emissions.length - 1]).toBe(true);

    vi.advanceTimersByTime(5_000);
    h.planRevision$.next();
    expect(h.emissions[h.emissions.length - 1]).toBe(false);

    h.unsubscribe();
  });
});
