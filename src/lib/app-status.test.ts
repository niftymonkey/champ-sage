import { describe, it, expect, vi } from "vitest";
import {
  createStatusRegistry,
  parseLaunchStatus,
  launchStatusToSubsystem,
  type SubsystemStatus,
} from "./app-status";

function status(over: Partial<SubsystemStatus> = {}): SubsystemStatus {
  return {
    id: "gep",
    level: "broken",
    message: "Augment coaching is unavailable.",
    ...over,
  };
}

describe("createStatusRegistry", () => {
  it("starts empty, so a healthy app shows nothing", () => {
    expect(createStatusRegistry().list()).toEqual([]);
  });

  it("lists what a subsystem reported", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "boot", message: "A boot step failed." }));
    expect(reg.list()).toEqual([
      { id: "boot", level: "broken", message: "A boot step failed." },
    ]);
  });

  // One subsystem, one banner. A subsystem that reports twice is telling us its
  // current state, not adding a second problem to the pile.
  it("replaces a subsystem's own status instead of stacking it", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep", message: "first" }));
    reg.set(status({ id: "gep", message: "second" }));
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].message).toBe("second");
  });

  it("keeps different subsystems apart", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep" }));
    reg.set(status({ id: "settings" }));
    expect(
      reg
        .list()
        .map((s) => s.id)
        .sort()
    ).toEqual(["gep", "settings"]);
  });

  it("clears a subsystem once it recovers", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep" }));
    reg.clear("gep");
    expect(reg.list()).toEqual([]);
  });

  it("ignores a clear for a subsystem that never reported", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep" }));
    reg.clear("settings");
    expect(reg.list()).toHaveLength(1);
  });

  // An `ok` report is a subsystem saying "I am fine", which is the same thing
  // as having nothing to show. Keeping it in the list would make every consumer
  // filter it out, and one of them would eventually forget.
  it("treats an ok report as a clear", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep", level: "broken" }));
    reg.set(status({ id: "gep", level: "ok", message: "fine now" }));
    expect(reg.list()).toEqual([]);
  });

  it("sorts worst first so the loudest banner is on top", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "app-update", level: "updating" }));
    reg.set(status({ id: "settings", level: "degraded" }));
    reg.set(status({ id: "boot", level: "broken" }));
    expect(reg.list().map((s) => s.level)).toEqual([
      "broken",
      "degraded",
      "updating",
    ]);
  });

  it("notifies subscribers with the whole list on every change", () => {
    const reg = createStatusRegistry();
    const seen = vi.fn();
    reg.subscribe(seen);
    reg.set(status({ id: "gep" }));
    reg.set(status({ id: "boot" }));
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[1][0]).toHaveLength(2);
  });

  it("notifies on a clear that actually removed something", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep" }));
    const seen = vi.fn();
    reg.subscribe(seen);
    reg.clear("gep");
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0][0]).toEqual([]);
  });

  // Otherwise a subsystem that polls its own health repaints every banner on a
  // timer, and any renderer keyed on the emission flickers.
  it("stays quiet when a clear changed nothing", () => {
    const reg = createStatusRegistry();
    const seen = vi.fn();
    reg.subscribe(seen);
    reg.clear("gep");
    expect(seen).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const reg = createStatusRegistry();
    const seen = vi.fn();
    const off = reg.subscribe(seen);
    off();
    reg.set(status({ id: "gep" }));
    expect(seen).not.toHaveBeenCalled();
  });

  // The registry runs during boot, when the thing consuming it is often the
  // thing that just broke. A throwing listener must not take down the reporter.
  it("survives a listener that throws and still reaches the others", () => {
    const reg = createStatusRegistry();
    const good = vi.fn();
    reg.subscribe(() => {
      throw new Error("banner exploded");
    });
    reg.subscribe(good);
    expect(() => reg.set(status({ id: "gep" }))).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it("hands out a list that cannot mutate its own state", () => {
    const reg = createStatusRegistry();
    reg.set(status({ id: "gep" }));
    reg.list().pop();
    expect(reg.list()).toHaveLength(1);
  });
});

describe("parseLaunchStatus", () => {
  it("reads a single token", () => {
    expect(parseLaunchStatus("unguarded")).toEqual(["unguarded"]);
  });

  it("reads a comma-separated list", () => {
    expect(parseLaunchStatus("unguarded,runtime-repaired")).toEqual([
      "unguarded",
      "runtime-repaired",
    ]);
  });

  it("tolerates whitespace the shell may have left behind", () => {
    expect(parseLaunchStatus(" unguarded , guard-crash ")).toEqual([
      "unguarded",
      "guard-crash",
    ]);
  });

  it("returns nothing when the launcher said nothing", () => {
    expect(parseLaunchStatus(undefined)).toEqual([]);
    expect(parseLaunchStatus("")).toEqual([]);
  });

  // The value arrives through a PowerShell command line, so an unknown token is
  // as likely to be corruption as a newer launcher. Dropping it beats banking a
  // banner on a string we do not recognise.
  it("drops tokens it does not recognise", () => {
    expect(parseLaunchStatus("unguarded,rm -rf,nonsense")).toEqual([
      "unguarded",
    ]);
  });

  it("does not repeat a token the launcher sent twice", () => {
    expect(parseLaunchStatus("unguarded,unguarded")).toEqual(["unguarded"]);
  });
});

describe("launchStatusToSubsystem", () => {
  it("says nothing when the launch was clean", () => {
    expect(launchStatusToSubsystem([])).toBeNull();
  });

  it("reports an unguarded launch as degraded, not broken", () => {
    const s = launchStatusToSubsystem(["unguarded"]);
    expect(s?.id).toBe("launch");
    expect(s?.level).toBe("degraded");
  });

  // A repaired runtime is the launcher working as designed. Telling the player
  // their app is damaged, when it just fixed itself, trains them to ignore
  // banners.
  it("does not raise a banner for a repair that succeeded", () => {
    expect(launchStatusToSubsystem(["runtime-repaired"])).toBeNull();
  });

  it("folds several problems into one banner for the one subsystem", () => {
    const s = launchStatusToSubsystem(["unguarded", "guard-crash"]);
    expect(s).not.toBeNull();
    expect(s?.id).toBe("launch");
  });

  it("mentions the guard crash in the detail so a log dive has a starting point", () => {
    const s = launchStatusToSubsystem(["guard-crash"]);
    expect(s?.detail ?? "").toContain("guard");
  });

  it("offers the logs, since nothing in-app can fix a launch problem", () => {
    expect(launchStatusToSubsystem(["unguarded"])?.action).toBe("open-logs");
  });
});
