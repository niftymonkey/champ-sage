import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useNotifications } from "../useNotifications";
import { notifications$ } from "../../lib/reactive";
import type { AppNotification } from "../../lib/reactive";

describe("useNotifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with an empty notification list", () => {
    const { result } = renderHook(() => useNotifications());

    expect(result.current).toEqual([]);
  });

  it("accumulates notifications as the observable emits", () => {
    const { result } = renderHook(() => useNotifications());

    const notification: AppNotification = {
      id: "n1",
      level: "info",
      message: "Game started",
      timestamp: Date.now(),
    };

    act(() => {
      notifications$.next(notification);
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].message).toBe("Game started");
  });

  it("auto-dismisses notifications after timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotifications());

    const notification: AppNotification = {
      id: "n2",
      level: "warning",
      message: "Connection lost",
      timestamp: Date.now(),
    };

    act(() => {
      notifications$.next(notification);
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toHaveLength(0);

    vi.useRealTimers();
  });

  it("unsubscribes on unmount", () => {
    const initialSubscribers = notifications$.observers.length;

    const { unmount } = renderHook(() => useNotifications());
    expect(notifications$.observers.length).toBe(initialSubscribers + 1);

    unmount();
    expect(notifications$.observers.length).toBe(initialSubscribers);
  });
});
