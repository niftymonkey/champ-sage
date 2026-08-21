import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAppStatus, useMainStatusBridge } from "../useAppStatus";
import { mainStatus$, localStatus$ } from "../../lib/reactive/streams";
import type { SubsystemStatus } from "../../lib/app-status";

function status(over: Partial<SubsystemStatus> = {}): SubsystemStatus {
  return { id: "gep", level: "broken", message: "broken", ...over };
}

/** Only the two members the bridge touches; the rest of the API is irrelevant here. */
function stubApi(over: Record<string, unknown> = {}) {
  const api = {
    onAppStatus: vi.fn(() => () => {}),
    getAppStatus: vi.fn(() => Promise.resolve<SubsystemStatus[]>([])),
    ...over,
  };
  Object.defineProperty(window, "electronAPI", {
    value: api,
    configurable: true,
    writable: true,
  });
  return api;
}

beforeEach(() => {
  mainStatus$.next([]);
  localStatus$.next([]);
});

afterEach(() => {
  mainStatus$.next([]);
  localStatus$.next([]);
  vi.restoreAllMocks();
});

describe("useMainStatusBridge", () => {
  it("publishes what the pull returned", async () => {
    stubApi({
      getAppStatus: vi.fn(() => Promise.resolve([status({ id: "boot" })])),
    });
    renderHook(() => useMainStatusBridge());
    await waitFor(() => expect(mainStatus$.value).toHaveLength(1));
    expect(mainStatus$.value[0].id).toBe("boot");
  });

  // An empty pull is an answer ("nothing is wrong"), not a non-answer. Treating
  // it as a non-answer leaves a stale banner up that a healthy main process
  // could never clear.
  it("clears a stale status when the pull comes back empty", async () => {
    mainStatus$.next([status({ id: "boot" })]);
    stubApi();
    renderHook(() => useMainStatusBridge());
    await waitFor(() => expect(mainStatus$.value).toEqual([]));
  });

  it("lets a push win over a slower pull", async () => {
    const pushes: Array<(all: SubsystemStatus[]) => void> = [];
    stubApi({
      onAppStatus: vi.fn((cb: (all: SubsystemStatus[]) => void) => {
        pushes.push(cb);
        return () => {};
      }),
      getAppStatus: vi.fn(() => Promise.resolve([status({ id: "boot" })])),
    });
    renderHook(() => useMainStatusBridge());
    pushes[0]?.([status({ id: "settings", level: "degraded" })]);
    await waitFor(() => expect(mainStatus$.value[0]?.id).toBe("settings"));
    expect(mainStatus$.value).toHaveLength(1);
  });

  it("does nothing outside Electron, where there is no bridge at all", () => {
    Object.defineProperty(window, "electronAPI", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(() => renderHook(() => useMainStatusBridge())).not.toThrow();
  });

  // The guard checks `onAppStatus` but the pull is a separate member, so this
  // pins that a half-present bridge cannot throw out of the effect. It holds
  // today because `getAppStatus?.()` short-circuits the whole `.then().catch()`
  // chain, which is easy to undo by "tidying" the optional call away.
  it("survives a bridge that can push but cannot be pulled", () => {
    stubApi({ getAppStatus: undefined });
    expect(() => renderHook(() => useMainStatusBridge())).not.toThrow();
  });
});

describe("useAppStatus", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useAppStatus());
    expect(result.current).toEqual([]);
  });

  it("reports both processes' statuses, worst first", async () => {
    const { result } = renderHook(() => useAppStatus());
    mainStatus$.next([status({ id: "settings", level: "degraded" })]);
    localStatus$.next([status({ id: "data", level: "broken" })]);
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0].id).toBe("data");
  });
});
