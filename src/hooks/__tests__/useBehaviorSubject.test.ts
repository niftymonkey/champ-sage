import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BehaviorSubject } from "rxjs";
import { useBehaviorSubject } from "../useBehaviorSubject";

describe("useBehaviorSubject", () => {
  it("returns the current value of the subject synchronously on first render", () => {
    const subject = new BehaviorSubject("initial");
    const { result } = renderHook(() => useBehaviorSubject(subject));
    expect(result.current).toBe("initial");
  });

  it("re-renders with the new value when the subject emits", () => {
    const subject = new BehaviorSubject(0);
    const { result } = renderHook(() => useBehaviorSubject(subject));
    expect(result.current).toBe(0);

    act(() => {
      subject.next(1);
    });
    expect(result.current).toBe(1);

    act(() => {
      subject.next(42);
    });
    expect(result.current).toBe(42);
  });

  it("works with object values (returns the same reference until next())", () => {
    const initial = { name: "lux" };
    const subject = new BehaviorSubject<{ name: string } | null>(initial);
    const { result, rerender } = renderHook(() => useBehaviorSubject(subject));

    expect(result.current).toBe(initial);
    rerender();
    expect(result.current).toBe(initial);

    const next = { name: "ashe" };
    act(() => {
      subject.next(next);
    });
    expect(result.current).toBe(next);
  });

  it("works with null/undefined values", () => {
    const subject = new BehaviorSubject<string | null>(null);
    const { result } = renderHook(() => useBehaviorSubject(subject));
    expect(result.current).toBeNull();

    act(() => {
      subject.next("set");
    });
    expect(result.current).toBe("set");
  });

  it("unsubscribes on unmount (no leaks; subsequent emissions don't update the unmounted hook)", () => {
    const subject = new BehaviorSubject(0);
    const { result, unmount } = renderHook(() => useBehaviorSubject(subject));

    expect(result.current).toBe(0);

    unmount();

    // After unmount, the subject should have no observers from the hook.
    // RxJS BehaviorSubject's `observers` array tracks active subscriptions.
    expect(subject.observed).toBe(false);
  });
});
