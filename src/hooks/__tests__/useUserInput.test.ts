import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useUserInput } from "../useUserInput";
import { manualInput$, playerIntent$ } from "../../lib/reactive";
import type { Augment } from "../../lib/data-ingest/types";

describe("useUserInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes augment events to manualInput$", () => {
    const spy = vi.fn();
    const sub = manualInput$.subscribe(spy);

    const { result } = renderHook(() => useUserInput());

    const augment: Augment = {
      name: "Test Augment",
      description: "A test",
      tier: "Silver",
      sets: [],
      mode: "mayhem",
    };

    act(() => {
      result.current.submit({ type: "augment", augment });
    });

    expect(spy).toHaveBeenCalledWith({ type: "augment", augment });
    sub.unsubscribe();
  });

  it("routes query events to playerIntent$", () => {
    const spy = vi.fn();
    const sub = playerIntent$.subscribe(spy);

    const { result } = renderHook(() => useUserInput());

    act(() => {
      result.current.submit({ type: "query", text: "what items to build?" });
    });

    expect(spy).toHaveBeenCalledWith({
      type: "query",
      text: "what items to build?",
    });
    sub.unsubscribe();
  });
});
