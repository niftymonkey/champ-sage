import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useCoaching } from "../useCoaching";
import { coaching$ } from "../../lib/reactive";
import type { CoachingMessage } from "../../lib/reactive";

describe("useCoaching", () => {
  afterEach(() => {
    // Subject has no reset, but observers are cleaned up via unmount
  });

  it("starts with an empty message list", () => {
    const { result } = renderHook(() => useCoaching());

    expect(result.current).toEqual([]);
  });

  it("accumulates messages as the observable emits", () => {
    const { result } = renderHook(() => useCoaching());

    const msg1: CoachingMessage = {
      id: "1",
      content: "Consider building armor",
      timestamp: Date.now(),
    };
    const msg2: CoachingMessage = {
      id: "2",
      content: "Ward dragon",
      timestamp: Date.now(),
    };

    act(() => {
      coaching$.next(msg1);
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].content).toBe("Consider building armor");

    act(() => {
      coaching$.next(msg2);
    });
    expect(result.current).toHaveLength(2);
    expect(result.current[1].content).toBe("Ward dragon");
  });

  it("unsubscribes on unmount", () => {
    const initialSubscribers = coaching$.observers.length;

    const { unmount } = renderHook(() => useCoaching());
    expect(coaching$.observers.length).toBe(initialSubscribers + 1);

    unmount();
    expect(coaching$.observers.length).toBe(initialSubscribers);
  });
});
