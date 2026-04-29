import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Subject } from "rxjs";
import type { GameMode } from "../../mode/types";
import { ProactiveEngine } from "./engine";
import type { DecisionPointTrigger } from "./types";

function makeMode(decisionTypes: GameMode["decisionTypes"]): GameMode {
  return { decisionTypes } as GameMode;
}

type HandleFn<T> = DecisionPointTrigger<T>["handle"];

function makeTrigger<T>(
  overrides: Partial<DecisionPointTrigger<T>> & { source$: Subject<T> } & {
    handle?: HandleFn<T>;
  }
): DecisionPointTrigger<T> {
  return {
    id: "t1",
    decisionType: "augment-selection",
    debounceMs: 0,
    cooldownMs: 0,
    handle: vi.fn<HandleFn<T>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ProactiveEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes handle after debounce window with ctx + signal", async () => {
    const source$ = new Subject<string>();
    const handle = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger = makeTrigger({ source$, debounceMs: 100, handle });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("ctx1");
    expect(handle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith("ctx1", expect.any(AbortSignal));

    engine.dispose();
  });

  it("debounces bursts — last ctx wins, one handle call", async () => {
    const source$ = new Subject<string>();
    const handle = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger = makeTrigger({ source$, debounceMs: 100, handle });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(50);
    source$.next("b");
    await vi.advanceTimersByTimeAsync(50);
    source$.next("c");
    await vi.advanceTimersByTimeAsync(100);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith("c", expect.any(AbortSignal));

    engine.dispose();
  });

  it("per-trigger cooldown drops emissions within window", async () => {
    const source$ = new Subject<string>();
    const handle = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger = makeTrigger({
      source$,
      debounceMs: 0,
      cooldownMs: 1000,
      handle,
    });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(500);
    source$.next("b"); // within cooldown
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toHaveBeenCalledOnce(); // still 1

    await vi.advanceTimersByTimeAsync(600); // total 1100 > cooldown
    source$.next("c");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenLastCalledWith("c", expect.any(AbortSignal));

    engine.dispose();
  });

  it("global min-gap blocks cross-trigger fires within window", async () => {
    const source1$ = new Subject<string>();
    const source2$ = new Subject<string>();
    const handle1 = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const handle2 = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger1 = makeTrigger({
      id: "t1",
      decisionType: "augment-selection",
      source$: source1$,
      handle: handle1,
    });
    const trigger2 = makeTrigger({
      id: "t2",
      decisionType: "item-purchase",
      source$: source2$,
      handle: handle2,
    });

    const engine = new ProactiveEngine(
      makeMode(["augment-selection", "item-purchase"]),
      [trigger1, trigger2],
      { globalMinGapMs: 1000 }
    );

    source1$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle1).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(500);
    source2$.next("b"); // within global gap
    await vi.advanceTimersByTimeAsync(0);
    expect(handle2).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600); // total 1100 > gap
    source2$.next("c");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle2).toHaveBeenCalledOnce();
    expect(handle2).toHaveBeenCalledWith("c", expect.any(AbortSignal));

    engine.dispose();
  });

  it("respectGlobalGap=false bypasses global min-gap", async () => {
    const source1$ = new Subject<string>();
    const source2$ = new Subject<string>();
    const handle1 = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const handle2 = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger1 = makeTrigger({
      id: "t1",
      decisionType: "augment-selection",
      source$: source1$,
      handle: handle1,
    });
    const trigger2 = makeTrigger({
      id: "t2",
      decisionType: "item-purchase",
      source$: source2$,
      respectGlobalGap: false,
      handle: handle2,
    });

    const engine = new ProactiveEngine(
      makeMode(["augment-selection", "item-purchase"]),
      [trigger1, trigger2],
      { globalMinGapMs: 10_000 }
    );

    source1$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    source2$.next("b"); // would be blocked, but bypasses
    await vi.advanceTimersByTimeAsync(0);

    expect(handle1).toHaveBeenCalledOnce();
    expect(handle2).toHaveBeenCalledOnce();

    engine.dispose();
  });

  it("aborts in-flight handle when source$ supersedes", async () => {
    const source$ = new Subject<string>();
    let firstSignal: AbortSignal | undefined;
    const handle = vi
      .fn<HandleFn<string>>()
      .mockImplementation(async (_ctx, signal) => {
        if (!firstSignal) firstSignal = signal;
        await new Promise(() => {}); // never resolves
      });
    const trigger = makeTrigger({
      source$,
      debounceMs: 0,
      cooldownMs: 0,
      handle,
    });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(false);

    source$.next("b");
    await vi.advanceTimersByTimeAsync(0);

    expect(firstSignal?.aborted).toBe(true);
    expect(handle).toHaveBeenCalledTimes(2);

    engine.dispose();
  });

  it("cancel$ aborts in-flight handle without firing again", async () => {
    const source$ = new Subject<string>();
    const cancel$ = new Subject<void>();
    let capturedSignal: AbortSignal | undefined;
    const handle = vi
      .fn<HandleFn<string>>()
      .mockImplementation(async (_ctx, signal) => {
        capturedSignal = signal;
        await new Promise(() => {});
      });
    const trigger = makeTrigger({
      source$,
      cancel$,
      debounceMs: 0,
      handle,
    });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(capturedSignal?.aborted).toBe(false);

    cancel$.next();
    expect(capturedSignal?.aborted).toBe(true);
    expect(handle).toHaveBeenCalledOnce(); // no additional fire

    engine.dispose();
  });

  it("skips triggers whose decisionType is not in mode.decisionTypes", async () => {
    const source$ = new Subject<string>();
    const handle = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger = makeTrigger({
      decisionType: "augment-selection",
      source$,
      handle,
    });

    // Mode that does NOT include augment-selection
    const engine = new ProactiveEngine(
      makeMode(["item-purchase", "open-ended-coaching"]),
      [trigger]
    );

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).not.toHaveBeenCalled();

    engine.dispose();
  });

  it("always registers passive-observation triggers regardless of mode", async () => {
    const source$ = new Subject<string>();
    const handle = vi.fn<HandleFn<string>>().mockResolvedValue(undefined);
    const trigger = makeTrigger({
      decisionType: "passive-observation",
      source$,
      handle,
    });

    const engine = new ProactiveEngine(
      makeMode(["open-ended-coaching"]), // no passive in mode
      [trigger]
    );

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toHaveBeenCalledOnce();

    engine.dispose();
  });

  it("dispose aborts in-flight and stops further fires", async () => {
    const source$ = new Subject<string>();
    let capturedSignal: AbortSignal | undefined;
    const handle = vi
      .fn<HandleFn<string>>()
      .mockImplementation(async (_ctx, signal) => {
        capturedSignal = signal;
        await new Promise(() => {});
      });
    const trigger = makeTrigger({ source$, debounceMs: 0, handle });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(capturedSignal?.aborted).toBe(false);

    engine.dispose();
    expect(capturedSignal?.aborted).toBe(true);

    source$.next("b");
    await vi.advanceTimersByTimeAsync(100);
    expect(handle).toHaveBeenCalledOnce(); // no new fire after dispose
  });

  it("clears the in-flight entry when handle resolves cleanly", async () => {
    const source$ = new Subject<string>();
    let resolveHandle: () => void = () => {};
    const handle = vi.fn<HandleFn<string>>().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveHandle = resolve;
        })
    );
    const trigger = makeTrigger({ source$, debounceMs: 0, handle });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.inFlightSize).toBe(1);

    resolveHandle();
    // Flush the .catch().finally() chain that runs cleanup
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.inFlightSize).toBe(0);

    engine.dispose();
  });

  it("clears the in-flight entry when handle rejects", async () => {
    const source$ = new Subject<string>();
    let rejectHandle: (e: Error) => void = () => {};
    const handle = vi.fn<HandleFn<string>>().mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectHandle = reject;
        })
    );
    const trigger = makeTrigger({ source$, debounceMs: 0, handle });

    const engine = new ProactiveEngine(makeMode(["augment-selection"]), [
      trigger,
    ]);

    source$.next("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.inFlightSize).toBe(1);

    rejectHandle(new Error("simulated handler failure"));
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.inFlightSize).toBe(0);

    engine.dispose();
  });
});
