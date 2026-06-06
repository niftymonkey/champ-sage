import { describe, it, expect } from "vitest";
import {
  manifestIndicatesOutage,
  discoverLatestVersion,
  buildOverrideManifest,
  planCacheReconciliation,
  GEP_UID,
  UTILITY_UID,
  OVERLAY_UID,
  type OverwolfPackagesManifest,
  type InstalledPackage,
} from "./ow-package-guard";

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

describe("buildOverrideManifest", () => {
  it("discovers gep and keeps utility/overlay on their live pins", async () => {
    const live: Record<number, string[]> = {
      1: ["306.0.2", "306.0.3"],
      2: ["2.7.5"],
      3: ["1.12.5"],
    };
    const manifest = await buildOverrideManifest((channel) =>
      liveProbe(live[channel] ?? [])
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
    const manifest = await buildOverrideManifest((channel) =>
      liveProbe(live[channel] ?? [])
    );
    const overlay = manifest!.packages.find((p) => p.name === "overlay");
    expect(overlay!.version).toBe("1.12.6");
  });

  it("returns null when gep cannot be resolved (override would be useless)", async () => {
    const manifest = await buildOverrideManifest(() => liveProbe([]));
    expect(manifest).toBeNull();
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
