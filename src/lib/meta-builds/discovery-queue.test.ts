import { describe, it, expect } from "vitest";
import { DiscoveryQueue } from "./discovery-queue";

function drain(q: DiscoveryQueue): string[] {
  const out: string[] = [];
  let x: string | undefined;
  while ((x = q.next()) !== undefined) out.push(x);
  return out;
}

describe("DiscoveryQueue", () => {
  it("drains frontier, then seed, then stale", () => {
    const q = new DiscoveryQueue();
    q.enqueueStale("s1");
    q.enqueueSeed("m1");
    q.enqueueFrontier("f1");
    q.enqueueStale("s2");
    q.enqueueSeed("m2");
    q.enqueueFrontier("f2");
    expect(drain(q)).toEqual(["f1", "f2", "m1", "m2", "s1", "s2"]);
  });

  it("returns a mid-stream frontier discovery before remaining seed and stale", () => {
    const q = new DiscoveryQueue();
    q.enqueueSeed("m1");
    q.enqueueStale("s1");
    expect(q.next()).toBe("m1"); // frontier empty, seed first
    q.enqueueFrontier("f1"); // a discovery arrives mid-drain
    expect(q.next()).toBe("f1"); // jumps ahead of the remaining stale
    expect(q.next()).toBe("s1");
  });

  it("preserves FIFO order within a tier", () => {
    const q = new DiscoveryQueue();
    q.enqueueFrontier("a");
    q.enqueueFrontier("b");
    q.enqueueFrontier("c");
    expect(drain(q)).toEqual(["a", "b", "c"]);
  });

  it("dedups across all tiers and does not promote", () => {
    const q = new DiscoveryQueue();
    q.enqueueStale("x");
    q.enqueueFrontier("x"); // already known in stale: no-op, stays in stale
    q.enqueueSeed("y");
    q.enqueueSeed("y"); // duplicate: no-op
    expect(q.size).toBe(2);
    expect(drain(q)).toEqual(["y", "x"]); // y (seed) before x (stale); x not promoted
  });

  it("does not re-admit a dequeued id", () => {
    const q = new DiscoveryQueue();
    q.enqueueFrontier("a");
    expect(q.next()).toBe("a");
    q.enqueueFrontier("a"); // already dequeued but still known
    expect(q.next()).toBeUndefined();
    expect(q.size).toBe(0);
  });

  it("tracks size and per-tier sizes", () => {
    const q = new DiscoveryQueue();
    q.enqueueFrontier("f");
    q.enqueueSeed("m1");
    q.enqueueSeed("m2");
    q.enqueueStale("s");
    expect(q.size).toBe(4);
    expect(q.frontierSize).toBe(1);
    expect(q.seedSize).toBe(2);
    expect(q.staleSize).toBe(1);
  });

  it("reports has() for queued ids and not for unknown ones", () => {
    const q = new DiscoveryQueue();
    q.enqueueSeed("known");
    expect(q.has("known")).toBe(true);
    expect(q.has("nope")).toBe(false);
  });

  it("iterates pending() frontier-first, then seed, then stale", () => {
    const q = new DiscoveryQueue();
    q.enqueueStale("s");
    q.enqueueFrontier("f");
    q.enqueueSeed("m");
    expect([...q.pending()]).toEqual(["f", "m", "s"]);
  });

  it("returns undefined from next() when empty", () => {
    expect(new DiscoveryQueue().next()).toBeUndefined();
  });
});
