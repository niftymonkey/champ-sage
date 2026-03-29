import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Subject } from "rxjs";
import {
  createAugmentCoachingController,
  DEBOUNCE_MS,
} from "./augment-coaching";

describe("augment coaching controller", () => {
  let offer$: Subject<string[]>;
  let picked$: Subject<string>;
  let submitQuery: ReturnType<typeof vi.fn<(names: string[]) => Promise<void>>>;
  let onPicked: ReturnType<typeof vi.fn<(name: string) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    offer$ = new Subject();
    picked$ = new Subject();
    submitQuery = vi
      .fn<(names: string[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    onPicked = vi.fn<(name: string) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createController() {
    return createAugmentCoachingController(offer$, picked$, {
      submitQuery,
      onPicked,
    });
  }

  it("submits a coaching query after the debounce period", () => {
    const ctrl = createController();

    offer$.next(["Cerberus", "Protein Shake", "Empyrean Promise"]);

    expect(submitQuery).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(submitQuery).toHaveBeenCalledOnce();
    expect(submitQuery).toHaveBeenCalledWith([
      "Cerberus",
      "Protein Shake",
      "Empyrean Promise",
    ]);

    ctrl.dispose();
  });

  it("resets the debounce when a new offer arrives (re-roll)", () => {
    const ctrl = createController();

    offer$.next(["Cerberus", "Protein Shake", "Empyrean Promise"]);
    vi.advanceTimersByTime(1500); // 1.5s — not yet fired

    // Re-roll changes the options
    offer$.next(["Circle of Death", "Protein Shake", "Empyrean Promise"]);
    vi.advanceTimersByTime(1500); // 1.5s since re-roll — still not fired

    expect(submitQuery).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // 2s since re-roll — fires now

    expect(submitQuery).toHaveBeenCalledOnce();
    expect(submitQuery).toHaveBeenCalledWith([
      "Circle of Death",
      "Protein Shake",
      "Empyrean Promise",
    ]);

    ctrl.dispose();
  });

  // Scenario 1: Pick within the debounce window cancels the pending query
  it("cancels the debounce timer when player picks an augment", () => {
    const ctrl = createController();

    offer$.next(["Cerberus", "Protein Shake", "Empyrean Promise"]);
    vi.advanceTimersByTime(1000); // 1s — timer still pending

    picked$.next("Protein Shake");

    // Advance past where the timer would have fired
    vi.advanceTimersByTime(2000);

    expect(submitQuery).not.toHaveBeenCalled();
    expect(onPicked).toHaveBeenCalledWith("Protein Shake");

    ctrl.dispose();
  });

  // Scenario 2: Pick while LLM is in flight aborts the request
  it("aborts in-flight LLM request when player picks an augment", () => {
    // submitQuery that never resolves (simulates in-flight request)
    submitQuery.mockImplementation(async () => {
      await new Promise(() => {}); // never resolves
    });

    const ctrl = createController();

    offer$.next(["Cerberus", "Protein Shake", "Empyrean Promise"]);
    vi.advanceTimersByTime(DEBOUNCE_MS); // query submitted

    expect(submitQuery).toHaveBeenCalledOnce();

    // Player picks while LLM is still thinking
    picked$.next("Cerberus");

    expect(onPicked).toHaveBeenCalledWith("Cerberus");

    ctrl.dispose();
  });

  // Scenario 3: Re-roll while LLM is in flight cancels and restarts
  it("aborts in-flight request and restarts debounce on re-roll", () => {
    submitQuery.mockImplementation(async () => {
      await new Promise(() => {}); // never resolves
    });

    const ctrl = createController();

    offer$.next(["Cerberus", "Protein Shake", "Empyrean Promise"]);
    vi.advanceTimersByTime(DEBOUNCE_MS); // first query submitted

    expect(submitQuery).toHaveBeenCalledOnce();

    // Re-roll changes options while first query is in flight
    offer$.next(["Cerberus", "Witchful Thinking", "Empyrean Promise"]);

    // First query should be aborted, new debounce started
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(submitQuery).toHaveBeenCalledTimes(2);
    expect(submitQuery).toHaveBeenLastCalledWith([
      "Cerberus",
      "Witchful Thinking",
      "Empyrean Promise",
    ]);

    ctrl.dispose();
  });

  it("does not fire after dispose", () => {
    const ctrl = createController();

    offer$.next(["Cerberus", "Protein Shake", "Empyrean Promise"]);
    ctrl.dispose();

    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(submitQuery).not.toHaveBeenCalled();
  });

  it("calls onPicked for each picked augment", () => {
    const ctrl = createController();

    picked$.next("Protein Shake");
    picked$.next("Red Envelopes");

    expect(onPicked).toHaveBeenCalledTimes(2);
    expect(onPicked).toHaveBeenCalledWith("Protein Shake");
    expect(onPicked).toHaveBeenCalledWith("Red Envelopes");

    ctrl.dispose();
  });
});
