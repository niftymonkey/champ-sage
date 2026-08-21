import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createReadinessTracker,
  PACKAGE_READY_TIMEOUT_MS,
  REQUIRED_PACKAGES,
} from "./package-readiness";
import type { SubsystemStatus } from "../src/lib/app-status";

function setup(
  over: { required?: readonly string[]; timeoutMs?: number } = {}
) {
  const seen: SubsystemStatus[] = [];
  const tracker = createReadinessTracker({
    required: over.required ?? ["gep", "overlay"],
    timeoutMs: over.timeoutMs,
    onStatus: (s) => seen.push(s),
  });
  return { tracker, seen, last: () => seen[seen.length - 1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createReadinessTracker", () => {
  it("says nothing while the packages are still on their way", () => {
    const { seen } = setup();
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS - 1);
    expect(seen).toEqual([]);
  });

  // The whole point: a package that never arrives used to produce silence, and
  // silence looked exactly like health.
  it("reports broken once the deadline passes with a package missing", () => {
    const { tracker, last } = setup();
    tracker.markReady("overlay");
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS);
    expect(last().id).toBe("package");
    expect(last().level).toBe("broken");
  });

  it("names the packages that never arrived, so the log has a starting point", () => {
    const { tracker, last } = setup();
    tracker.markReady("overlay");
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS);
    expect(last().detail ?? "").toContain("gep");
    expect(last().detail ?? "").not.toContain("overlay");
  });

  it("stays quiet when everything arrives in time", () => {
    const { tracker, seen } = setup();
    tracker.markReady("gep");
    tracker.markReady("overlay");
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS * 2);
    expect(seen).toEqual([]);
  });

  it("ignores a package it was not asked to watch", () => {
    const { tracker, seen } = setup({ required: ["gep"] });
    tracker.markReady("something-else");
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0].level).toBe("broken");
  });

  // A slow download that finishes at 70s leaves a banner claiming the package
  // is gone, while the feature it gates works fine.
  it("heals the banner when a late package finally arrives", () => {
    const { tracker, seen, last } = setup();
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS);
    expect(last().level).toBe("broken");
    tracker.markReady("gep");
    tracker.markReady("overlay");
    expect(last().level).toBe("ok");
    expect(seen.filter((s) => s.level === "ok")).toHaveLength(1);
  });

  it("keeps the banner up while only some of the late packages arrive", () => {
    const { tracker, last } = setup();
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS);
    tracker.markReady("gep");
    expect(last().level).toBe("broken");
  });

  // main.ts forwards lifecycle events for EVERY Overwolf package, so a package
  // we do not depend on could otherwise raise a banner claiming augment
  // coaching and the overlay are down.
  it("ignores a failure in a package it was not asked to watch", () => {
    const { tracker, seen } = setup({ required: ["gep"] });
    tracker.markFailed("some-other-package", "boom");
    expect(seen).toEqual([]);
  });

  it("ignores a crash in a package it was not asked to watch", () => {
    const { tracker, seen } = setup({ required: ["gep"] });
    tracker.markCrashed("some-other-package", false);
    expect(seen).toEqual([]);
  });

  it("still watches the deadline after an unwatched package fails", () => {
    const { tracker, seen } = setup({ required: ["gep"] });
    tracker.markFailed("some-other-package", "boom");
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0].detail ?? "").toContain("gep");
  });

  it("reports a failure the moment OWEPM announces it, without waiting", () => {
    const { tracker, last } = setup();
    tracker.markFailed("gep", "manifest 503");
    expect(last().level).toBe("broken");
    expect(last().detail ?? "").toContain("manifest 503");
  });

  // `canRecover` is OWEPM saying it intends to restart the package itself.
  // Announcing a crash the platform is already fixing as "broken" would be a
  // banner the player cannot act on and that clears itself seconds later.
  it("treats a recoverable crash as degraded, not broken", () => {
    const { tracker, last } = setup();
    tracker.markCrashed("gep", true);
    expect(last().level).toBe("degraded");
  });

  it("treats an unrecoverable crash as broken", () => {
    const { tracker, last } = setup();
    tracker.markCrashed("gep", false);
    expect(last().level).toBe("broken");
  });

  it("stops the deadline on dispose, so a quit does not raise a banner", () => {
    const { tracker, seen } = setup();
    tracker.dispose();
    vi.advanceTimersByTime(PACKAGE_READY_TIMEOUT_MS * 2);
    expect(seen).toEqual([]);
  });

  it("survives being disposed twice", () => {
    const { tracker } = setup();
    tracker.dispose();
    expect(() => tracker.dispose()).not.toThrow();
  });

  it("watches gep and overlay by default", () => {
    expect([...REQUIRED_PACKAGES].sort()).toEqual(["gep", "overlay"]);
  });

  it("waits a full minute, long enough for a cold cache to download GEP", () => {
    expect(PACKAGE_READY_TIMEOUT_MS).toBe(60_000);
  });

  it("honours a caller-supplied deadline", () => {
    const { seen } = setup({ timeoutMs: 10 });
    vi.advanceTimersByTime(10);
    expect(seen).toHaveLength(1);
  });
});
