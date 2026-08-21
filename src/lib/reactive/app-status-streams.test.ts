import { describe, it, expect } from "vitest";
import { firstValueFrom } from "rxjs";
import {
  mergeStatuses,
  appStatus$,
  mainStatus$,
  localStatus$,
} from "./streams";
import type { SubsystemStatus } from "../app-status";

function status(over: Partial<SubsystemStatus> = {}): SubsystemStatus {
  return { id: "gep", level: "broken", message: "broken", ...over };
}

describe("mergeStatuses", () => {
  it("is empty when neither process has anything to say", () => {
    expect(mergeStatuses([], [])).toEqual([]);
  });

  it("carries statuses through from both processes", () => {
    const merged = mergeStatuses(
      [status({ id: "gep" })],
      [status({ id: "data" })]
    );
    expect(merged.map((s) => s.id).sort()).toEqual(["data", "gep"]);
  });

  // The renderer is the side closer to what the player is looking at, so when
  // both processes describe the same subsystem it is the one to believe.
  it("lets the renderer's view win for a subsystem both reported", () => {
    const merged = mergeStatuses(
      [status({ id: "data", message: "from main" })],
      [status({ id: "data", message: "from renderer" })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe("from renderer");
  });

  it("sorts worst first so the loudest banner is on top", () => {
    const merged = mergeStatuses(
      [
        status({ id: "app-update", level: "updating" }),
        status({ id: "boot", level: "broken" }),
      ],
      [status({ id: "data", level: "degraded" })]
    );
    expect(merged.map((s) => s.level)).toEqual([
      "broken",
      "degraded",
      "updating",
    ]);
  });

  // The main-process registry already drops `ok`, but `localStatus$` is written
  // by renderer code with no registry in front of it, so the merge is the last
  // place an "I am fine" can be stopped from rendering as a banner.
  it("drops an ok report rather than rendering it as a banner", () => {
    const merged = mergeStatuses([], [status({ id: "data", level: "ok" })]);
    expect(merged).toEqual([]);
  });

  it("lets an ok from the renderer clear what main reported", () => {
    const merged = mergeStatuses(
      [status({ id: "data", level: "broken" })],
      [status({ id: "data", level: "ok" })]
    );
    expect(merged).toEqual([]);
  });
});

describe("appStatus$", () => {
  it("starts empty so a healthy app renders no banners", async () => {
    mainStatus$.next([]);
    localStatus$.next([]);
    expect(await firstValueFrom(appStatus$)).toEqual([]);
  });

  it("emits the merge of both sources", async () => {
    mainStatus$.next([status({ id: "gep" })]);
    localStatus$.next([status({ id: "data", level: "degraded" })]);
    const merged = await firstValueFrom(appStatus$);
    expect(merged.map((s) => s.id)).toEqual(["gep", "data"]);
    mainStatus$.next([]);
    localStatus$.next([]);
  });
});
