import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  manifestIndicatesOutage,
  discoverLatestVersion,
  discoveryBaseline,
  resolveGepVersion,
  buildOverrideManifest,
  planCacheReconciliation,
  decideGuardAction,
  createCachedResolver,
  GEP_UID,
  UTILITY_UID,
  OVERLAY_UID,
  type OverwolfPackagesManifest,
  type InstalledPackage,
  type Version,
  healthcheckExitCode,
  resolveCliMode,
  cliMain,
  withTimeout,
  listenOrFail,
  EXIT_GUARD_CRASH,
  EXIT_SERVE_LISTEN_FAILED,
  type CliHandlers,
} from "./ow-package-guard";

/** A fetcher standing in for an unreachable manifest, forcing CDN discovery. */
const noManifest = () => Promise.resolve<OverwolfPackagesManifest | null>(null);

/** A floor lookup standing in for an unreachable status endpoint. */
const noFloor = () => Promise.resolve<Version | null>(null);

/** A floor lookup returning a fixed published floor, plus a call counter. */
function floorLookupOf(floor: Version | null) {
  const calls = { count: 0 };
  const lookup = () => {
    calls.count++;
    return Promise.resolve(floor);
  };
  return { lookup, calls };
}

function manifestWithGep(gepVersion: string): OverwolfPackagesManifest {
  return {
    packages: [
      { name: "gep", uid: "g", version: gepVersion, url: "u" },
      { name: "overlay", uid: "o", version: "1.12.5", url: "u" },
    ],
  };
}

/**
 * Builds a `probe` over a fixed set of "live" version strings, mirroring the
 * CDN's behavior (downloadable → true, rotated/unpublished → false).
 */
function liveProbe(live: string[]): (version: string) => Promise<boolean> {
  const set = new Set(live);
  return (version) => Promise.resolve(set.has(version));
}

describe("manifestIndicatesOutage", () => {
  it("flags the outage when gep is pinned to the 0.0.0 placeholder", () => {
    expect(manifestIndicatesOutage(manifestWithGep("0.0.0"))).toBe(true);
  });

  it("treats a real gep version as healthy", () => {
    expect(manifestIndicatesOutage(manifestWithGep("305.1.3"))).toBe(false);
  });

  it("treats a manifest with no gep package as healthy (no override)", () => {
    expect(manifestIndicatesOutage({ packages: [] })).toBe(false);
  });
});

describe("discoverLatestVersion", () => {
  it("returns the newest live build, tolerating the leading rotated gap", async () => {
    // 306.0.0 / 306.0.1 are rotated to 403; 306.0.2 / 306.0.3 are live.
    const version = await discoverLatestVersion({
      baseline: { major: 306, minor: 0, patch: 0 },
      probe: liveProbe(["306.0.2", "306.0.3"]),
    });
    expect(version).toBe("306.0.3");
  });

  it("tolerates an internal gap within the miss budget", async () => {
    const version = await discoverLatestVersion({
      baseline: { major: 306, minor: 0, patch: 0 },
      probe: liveProbe(["306.0.2", "306.0.5"]),
    });
    expect(version).toBe("306.0.5");
  });

  it("discovers a minor-version bump above the baseline", async () => {
    const version = await discoverLatestVersion({
      baseline: { major: 306, minor: 0, patch: 0 },
      probe: liveProbe(["306.1.0", "306.1.1"]),
    });
    expect(version).toBe("306.1.1");
  });

  it("discovers a major-version bump above the baseline", async () => {
    const version = await discoverLatestVersion({
      baseline: { major: 306, minor: 0, patch: 0 },
      probe: liveProbe(["307.0.0"]),
    });
    expect(version).toBe("307.0.0");
  });

  it("picks the highest build across version lines", async () => {
    const version = await discoverLatestVersion({
      baseline: { major: 306, minor: 0, patch: 0 },
      probe: liveProbe(["306.0.3", "306.1.0"]),
    });
    expect(version).toBe("306.1.0");
  });

  it("returns null when nothing is live near the baseline", async () => {
    const version = await discoverLatestVersion({
      baseline: { major: 306, minor: 0, patch: 0 },
      probe: liveProbe([]),
    });
    expect(version).toBeNull();
  });
});

describe("discoveryBaseline", () => {
  const anchor = { major: 306, minor: 0, patch: 0 };

  it("probes from League's floor when it is above the maintained anchor", () => {
    // The anchor goes stale as Overwolf rotates old lines off the CDN; the
    // published floor is the live, self-updating lower bound.
    expect(
      discoveryBaseline(anchor, { major: 307, minor: 4, patch: 2 })
    ).toEqual({ major: 307, minor: 4, patch: 2 });
  });

  it("keeps the anchor when the floor sits below it", () => {
    expect(
      discoveryBaseline(anchor, { major: 305, minor: 1, patch: 3 })
    ).toEqual(anchor);
  });

  it("keeps the anchor when the floor is unknown", () => {
    expect(discoveryBaseline(anchor, null)).toEqual(anchor);
  });
});

describe("resolveGepVersion", () => {
  const baseline = { major: 306, minor: 0, patch: 0 };

  afterEach(() => {
    delete process.env.GEP_FORCE_VERSION;
  });

  it("prefers the manifest-advertised build when it is downloadable on the CDN", async () => {
    // The recovered manifest advertises 307.4.6. CDN discovery from baseline
    // 306.0.0 can only reach 306.0.10 (307.0.x is a 403 gap), so without the
    // manifest seed the guard would serve the stale, floor-rejected 306.0.10.
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.10", "307.4.6"]),
      manifest: manifestWithGep("307.4.6"),
      floorLookup: noFloor,
    });
    expect(version).toBe("307.4.6");
  });

  it("falls back to CDN discovery when the advertised build is not downloadable", async () => {
    // Manifest advertises a build whose binary has not propagated to the CDN.
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: manifestWithGep("307.9.9"),
      floorLookup: noFloor,
    });
    expect(version).toBe("306.0.3");
  });

  it("falls back to CDN discovery during the 0.0.0 outage", async () => {
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: manifestWithGep("0.0.0"),
      floorLookup: noFloor,
    });
    expect(version).toBe("306.0.3");
  });

  it("falls back to CDN discovery when the manifest is unreachable", async () => {
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: null,
      floorLookup: noFloor,
    });
    expect(version).toBe("306.0.3");
  });

  it("returns null when neither the manifest nor the CDN yields a build", async () => {
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe([]),
      manifest: null,
      floorLookup: noFloor,
    });
    expect(version).toBeNull();
  });

  it("seeds CDN discovery from the published floor when the manifest fails", async () => {
    // The stale-anchor scenario: 307.0.x is rotated off, so discovery from
    // 306.0.0 tops out below the floor and would serve a build League rejects.
    const { lookup } = floorLookupOf({ major: 307, minor: 4, patch: 2 });
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.3", "307.4.2", "307.4.3"]),
      manifest: null,
      floorLookup: lookup,
    });
    expect(version).toBe("307.4.3");
  });

  it("reads the floor once per resolve", async () => {
    const { lookup, calls } = floorLookupOf({ major: 307, minor: 4, patch: 2 });
    await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.10", "307.4.6"]),
      manifest: manifestWithGep("307.4.6"),
      floorLookup: lookup,
    });
    expect(calls.count).toBe(1);
  });

  it("rejects a manifest build below the floor and discovers one that clears it", async () => {
    // A downloadable but stale advertised build is still rejected at
    // game-attach, so serving it is knowingly serving a dead GEP.
    const { lookup } = floorLookupOf({ major: 307, minor: 4, patch: 2 });
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.10", "307.4.2", "307.4.3"]),
      manifest: manifestWithGep("306.0.10"),
      floorLookup: lookup,
    });
    expect(version).toBe("307.4.3");
  });

  it("rejects an unparseable advertised build when the floor is known", async () => {
    // "clears the floor" has to mean "compared against the floor and won". An
    // unparseable version cannot be compared at all, so treating it as passing
    // would let exactly the malformed manifest data this guard exists for walk
    // straight past League's minimum.
    const { lookup } = floorLookupOf({ major: 307, minor: 4, patch: 2 });
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["not-a-version", "307.4.2", "307.4.3"]),
      manifest: manifestWithGep("not-a-version"),
      floorLookup: lookup,
    });
    expect(version).toBe("307.4.3");
  });

  it("never serves an unparseable advertised build as the last-resort fallback", async () => {
    // The below-floor fallback is a deliberate "something beats nothing", but
    // it is only sound for a version we could actually compare. Serving an
    // unparseable one is serving a URL nobody has reason to believe in.
    const { lookup } = floorLookupOf({ major: 307, minor: 4, patch: 2 });
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["not-a-version"]),
      manifest: manifestWithGep("not-a-version"),
      floorLookup: lookup,
    });
    expect(version).toBeNull();
  });

  it("discovers a floor-clearing build when the floor patch is past the scan cap", async () => {
    // The scan bound is a span from where discovery starts, not an absolute
    // patch number. Seeding from the floor means the start can be any patch
    // League has reached, and an absolute cap would silently probe nothing at
    // all once the floor passed it.
    const { lookup } = floorLookupOf({ major: 307, minor: 4, patch: 49 });
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.3", "307.4.49", "307.4.50"]),
      manifest: null,
      floorLookup: lookup,
    });
    expect(version).toBe("307.4.50");
  });

  it("serves a below-floor advertised build when discovery finds nothing better", async () => {
    // Last resort: a below-floor override still beats no override, which lets
    // OWEPM re-stub the cache and lose the overlay too.
    const { lookup } = floorLookupOf({ major: 307, minor: 4, patch: 2 });
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.10"]),
      manifest: manifestWithGep("306.0.10"),
      floorLookup: lookup,
    });
    expect(version).toBe("306.0.10");
  });

  it("serves GEP_FORCE_VERSION when that build is downloadable (test hook)", async () => {
    process.env.GEP_FORCE_VERSION = "306.0.10";
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.10", "307.4.6"]),
      manifest: manifestWithGep("307.4.6"),
      floorLookup: noFloor,
    });
    expect(version).toBe("306.0.10");
  });

  it("ignores GEP_FORCE_VERSION when that build is not downloadable and falls back", async () => {
    process.env.GEP_FORCE_VERSION = "999.9.9";
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: null,
      floorLookup: noFloor,
    });
    expect(version).toBe("306.0.3");
  });
});

describe("buildOverrideManifest", () => {
  it("seeds gep from the recovered manifest when that build is downloadable", async () => {
    // Regression for the stale-baseline bug: --serve must serve the manifest's
    // 307.4.6, not the 306.0.10 that bare CDN discovery would settle on.
    const live: Record<number, string[]> = {
      1: ["306.0.10", "307.4.6"],
      2: ["2.7.5"],
      3: ["1.12.5"],
    };
    const manifest = await buildOverrideManifest(
      (channel) => liveProbe(live[channel] ?? []),
      () => Promise.resolve(manifestWithGep("307.4.6")),
      noFloor
    );
    const gep = manifest!.packages.find((p) => p.name === "gep");
    expect(gep!.version).toBe("307.4.6");
    expect(gep!.url).toBe(
      "https://electrondl.overwolf.com/1/307.4.6/module.owepk"
    );
  });

  it("seeds gep discovery from the floor when the manifest is unreachable", async () => {
    const live: Record<number, string[]> = {
      1: ["306.0.3", "307.4.2"],
      2: ["2.7.5"],
      3: ["1.12.5"],
    };
    const manifest = await buildOverrideManifest(
      (channel) => liveProbe(live[channel] ?? []),
      noManifest,
      () => Promise.resolve({ major: 307, minor: 4, patch: 2 })
    );
    const gep = manifest!.packages.find((p) => p.name === "gep");
    expect(gep!.version).toBe("307.4.2");
  });

  it("discovers gep and keeps utility/overlay on their live pins", async () => {
    const live: Record<number, string[]> = {
      1: ["306.0.2", "306.0.3"],
      2: ["2.7.5"],
      3: ["1.12.5"],
    };
    const manifest = await buildOverrideManifest(
      (channel) => liveProbe(live[channel] ?? []),
      noManifest,
      noFloor
    );
    expect(manifest).not.toBeNull();

    const byName = Object.fromEntries(
      manifest!.packages.map((p) => [p.name, p])
    );
    expect(byName.gep.version).toBe("306.0.3");
    expect(byName.utility.version).toBe("2.7.5");
    expect(byName.overlay.version).toBe("1.12.5");

    for (const pkg of manifest!.packages) {
      expect(pkg.version).not.toBe("0.0.0");
      expect(pkg.url).toMatch(
        /^https:\/\/electrondl\.overwolf\.com\/\d+\/[\d.]+\/module\.owepk$/
      );
    }
    expect(byName.gep.uid).toBe(GEP_UID);
    expect(byName.utility.uid).toBe(UTILITY_UID);
    expect(byName.overlay.uid).toBe(OVERLAY_UID);
  });

  it("heals a package whose pin has been rotated off the CDN", async () => {
    // overlay pin (1.12.5) is dead; a newer 1.12.6 is live → heal up to it.
    const live: Record<number, string[]> = {
      1: ["306.0.3"],
      2: ["2.7.5"],
      3: ["1.12.6"],
    };
    const manifest = await buildOverrideManifest(
      (channel) => liveProbe(live[channel] ?? []),
      noManifest,
      noFloor
    );
    const overlay = manifest!.packages.find((p) => p.name === "overlay");
    expect(overlay!.version).toBe("1.12.6");
  });

  it("returns null when gep cannot be resolved (override would be useless)", async () => {
    const manifest = await buildOverrideManifest(
      () => liveProbe([]),
      noManifest,
      noFloor
    );
    expect(manifest).toBeNull();
  });
});

describe("decideGuardAction", () => {
  it("serves the override whenever a live build is resolvable", () => {
    // Even when the cache already holds that build: OWEPM re-stubs a good
    // cache on every launch the override is not active, so we always override.
    expect(decideGuardAction({ latestServed: "306.0.10" })).toBe(
      "override-needed"
    );
  });

  it("cannot resolve (no override) when no live build is found", () => {
    expect(decideGuardAction({ latestServed: null })).toBe("cannot-resolve");
  });
});

describe("planCacheReconciliation", () => {
  const desired = [
    { uid: GEP_UID, version: "306.0.3" },
    { uid: UTILITY_UID, version: "2.7.5" },
    { uid: OVERLAY_UID, version: "1.12.5" },
  ];

  it("purges only the packages whose cached version is stale", () => {
    const installed: InstalledPackage[] = [
      { uid: GEP_UID, version: "305.1.3" },
      { uid: UTILITY_UID, version: "2.7.5" },
      { uid: OVERLAY_UID, version: "1.12.5" },
    ];
    expect(planCacheReconciliation(installed, desired)).toEqual([GEP_UID]);
  });

  it("purges nothing when every cached version already matches", () => {
    const installed: InstalledPackage[] = [
      { uid: GEP_UID, version: "306.0.3" },
      { uid: UTILITY_UID, version: "2.7.5" },
    ];
    expect(planCacheReconciliation(installed, desired)).toEqual([]);
  });

  it("ignores cached packages that are not part of the override", () => {
    const installed: InstalledPackage[] = [
      { uid: "some-other-package", version: "9.9.9" },
    ];
    expect(planCacheReconciliation(installed, desired)).toEqual([]);
  });
});

describe("createCachedResolver", () => {
  it("resolves once and serves the cached value within the TTL", async () => {
    let calls = 0;
    let t = 1000;
    const get = createCachedResolver({
      resolve: async () => {
        calls++;
        return `v${calls}`;
      },
      ttlMs: 100,
      now: () => t,
    });
    expect(await get()).toBe("v1");
    t = 1050; // still within the TTL window
    expect(await get()).toBe("v1");
    expect(calls).toBe(1);
  });

  it("re-resolves after the TTL elapses", async () => {
    let calls = 0;
    let t = 1000;
    const get = createCachedResolver({
      resolve: async () => {
        calls++;
        return `v${calls}`;
      },
      ttlMs: 100,
      now: () => t,
    });
    expect(await get()).toBe("v1");
    t = 1200; // past the TTL
    expect(await get()).toBe("v2");
    expect(calls).toBe(2);
  });

  it("keeps the last good value when a re-resolve returns null", async () => {
    let t = 1000;
    let result: string | null = "good";
    const get = createCachedResolver({
      resolve: async () => result,
      ttlMs: 100,
      now: () => t,
    });
    expect(await get()).toBe("good");
    t = 1200;
    result = null; // transient resolve failure
    expect(await get()).toBe("good");
  });

  it("returns null when the very first resolve fails", async () => {
    const get = createCachedResolver({
      resolve: async () => null,
      ttlMs: 100,
      now: () => 0,
    });
    expect(await get()).toBeNull();
  });
});

describe("healthcheckExitCode", () => {
  it("exits 0 only when the version was checked and cleared the floor", () => {
    expect(healthcheckExitCode("green")).toBe(0);
  });

  it("exits 2 when augments will be silently unavailable", () => {
    expect(healthcheckExitCode("red")).toBe(2);
  });

  it("exits 1 on a platform-reported feature outage", () => {
    expect(healthcheckExitCode("warn")).toBe(1);
  });

  // Before `unknown` existed, an unfetchable floor evaluated green. The naive
  // rewrite is a trailing `: 2`, which flips it all the way to "augments are
  // broken" instead. Not being able to check is undetermined, which is 1, the
  // same shape the runtime preflight uses.
  it("exits 1, not 2, when the check could not be made", () => {
    expect(healthcheckExitCode("unknown")).toBe(1);
  });
});

/** Handlers that fail the test if a mode other than the expected one runs. */
function handlersOf(over: Partial<CliHandlers> = {}): CliHandlers {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`unexpected ${name} handler call`));
  return {
    check: over.check ?? unexpected("check"),
    healthcheck: over.healthcheck ?? unexpected("healthcheck"),
    serve: over.serve ?? unexpected("serve"),
  };
}

describe("resolveCliMode", () => {
  it("defaults to check, the mode the launcher runs before every launch", () => {
    expect(resolveCliMode([])).toBe("check");
    expect(resolveCliMode(["--url", "http://x"])).toBe("check");
  });

  it("reads the explicit modes", () => {
    expect(resolveCliMode(["--serve", "--port", "1"])).toBe("serve");
    expect(resolveCliMode(["--healthcheck"])).toBe("healthcheck");
  });

  // Serving is the mode that keeps a process alive and holds a port, so an
  // argument list asking for both must not silently start a resident server.
  it("prefers serve when both serve and healthcheck are passed", () => {
    expect(resolveCliMode(["--healthcheck", "--serve"])).toBe("serve");
  });
});

describe("cliMain", () => {
  it("returns the handler's exit code", async () => {
    const code = await cliMain(
      [],
      handlersOf({ check: () => Promise.resolve(3) })
    );
    expect(code).toBe(3);
  });

  it("returns null for a serve that is resident and healthy", async () => {
    const code = await cliMain(
      ["--serve"],
      handlersOf({ serve: () => Promise.resolve(null) })
    );
    expect(code).toBeNull();
  });

  // The whole point of the code. A crash used to surface as an unhandled
  // rejection, which exits 1, which the launcher reads as the benign "no live
  // build" degrade: a broken guard silently launching an unverified GEP.
  it("turns a crashing handler into the guard-crash code, not a degrade", async () => {
    const code = await cliMain(
      [],
      handlersOf({ check: () => Promise.reject(new Error("boom")) })
    );
    expect(code).toBe(EXIT_GUARD_CRASH);
  });

  it("treats a synchronous throw as a crash too", async () => {
    const code = await cliMain(
      ["--healthcheck"],
      handlersOf({
        healthcheck: () => {
          throw new Error("boom");
        },
      })
    );
    expect(code).toBe(EXIT_GUARD_CRASH);
  });

  // A resolution failure is not a guard failure. The launcher already knows how
  // to launch unguarded on 1; it must keep doing that.
  it("passes a reported failure through untouched", async () => {
    const code = await cliMain(
      [],
      handlersOf({ check: () => Promise.resolve(1) })
    );
    expect(code).toBe(1);
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the work's own answer when it settles in time", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      20_000,
      () => "gave up"
    );
    expect(result).toBe("done");
  });

  // Resolution is network-bound and runs before any window exists, so a
  // degraded connection used to hold the launch open for as long as the sockets
  // took.
  it("gives up once the deadline passes", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const pending = withTimeout(never, 20_000, () => "gave up");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toBe("gave up");
  });

  it("does not give up one tick early", async () => {
    vi.useFakeTimers();
    let settle: ((v: string) => void) | null = null;
    const work = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const pending = withTimeout(work, 20_000, () => "gave up");
    await vi.advanceTimersByTimeAsync(19_999);
    settle?.("done");
    expect(await pending).toBe("done");
  });

  // A left-running timer keeps Node's event loop alive, so a guard that
  // finished its work would sit there for the rest of the deadline.
  it("clears its timer once the work settles", async () => {
    vi.useFakeTimers();
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve("done"), 20_000, () => "gave up");
    expect(cleared).toHaveBeenCalled();
  });
});

describe("listenOrFail", () => {
  it("resolves null once the port is taken and the server is serving", async () => {
    const server = createServer(() => {});
    const code = await listenOrFail(server, 0);
    expect(code).toBeNull();
    await new Promise((r) => server.close(r));
  });

  // No listen error handler meant EADDRINUSE threw as an unhandled 'error'
  // event, and the launcher sat through its full readiness probe before
  // deciding to launch unguarded.
  it("reports a taken port instead of throwing", async () => {
    const first = createServer(() => {});
    await listenOrFail(first, 0);
    const port = (first.address() as AddressInfo).port;

    const second = createServer(() => {});
    const code = await listenOrFail(second, port);
    expect(code).toBe(EXIT_SERVE_LISTEN_FAILED);

    await new Promise((r) => first.close(r));
  });
});
