import { describe, it, expect } from "vitest";
import {
  manifestIndicatesOutage,
  discoverLatestVersion,
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
} from "./ow-package-guard";

/** A fetcher standing in for an unreachable manifest, forcing CDN discovery. */
const noManifest = () => Promise.resolve<OverwolfPackagesManifest | null>(null);

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

describe("resolveGepVersion", () => {
  const baseline = { major: 306, minor: 0, patch: 0 };

  it("prefers the manifest-advertised build when it is downloadable on the CDN", async () => {
    // The recovered manifest advertises 307.4.6. CDN discovery from baseline
    // 306.0.0 can only reach 306.0.10 (307.0.x is a 403 gap), so without the
    // manifest seed the guard would serve the stale, floor-rejected 306.0.10.
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.10", "307.4.6"]),
      manifest: manifestWithGep("307.4.6"),
    });
    expect(version).toBe("307.4.6");
  });

  it("falls back to CDN discovery when the advertised build is not downloadable", async () => {
    // Manifest advertises a build whose binary has not propagated to the CDN.
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: manifestWithGep("307.9.9"),
    });
    expect(version).toBe("306.0.3");
  });

  it("falls back to CDN discovery during the 0.0.0 outage", async () => {
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: manifestWithGep("0.0.0"),
    });
    expect(version).toBe("306.0.3");
  });

  it("falls back to CDN discovery when the manifest is unreachable", async () => {
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe(["306.0.2", "306.0.3"]),
      manifest: null,
    });
    expect(version).toBe("306.0.3");
  });

  it("returns null when neither the manifest nor the CDN yields a build", async () => {
    const version = await resolveGepVersion({
      baseline,
      probe: liveProbe([]),
      manifest: null,
    });
    expect(version).toBeNull();
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
      () => Promise.resolve(manifestWithGep("307.4.6"))
    );
    const gep = manifest!.packages.find((p) => p.name === "gep");
    expect(gep!.version).toBe("307.4.6");
    expect(gep!.url).toBe(
      "https://electrondl.overwolf.com/1/307.4.6/module.owepk"
    );
  });

  it("discovers gep and keeps utility/overlay on their live pins", async () => {
    const live: Record<number, string[]> = {
      1: ["306.0.2", "306.0.3"],
      2: ["2.7.5"],
      3: ["1.12.5"],
    };
    const manifest = await buildOverrideManifest(
      (channel) => liveProbe(live[channel] ?? []),
      noManifest
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
      noManifest
    );
    const overlay = manifest!.packages.find((p) => p.name === "overlay");
    expect(overlay!.version).toBe("1.12.6");
  });

  it("returns null when gep cannot be resolved (override would be useless)", async () => {
    const manifest = await buildOverrideManifest(
      () => liveProbe([]),
      noManifest
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
