import { describe, it, expect } from "vitest";
import {
  parseVersion,
  compareVersions,
  evaluateGepHealth,
  fetchGepFloor,
  gepStatusUrl,
  type FloorFetcher,
} from "./gep-health";

describe("parseVersion", () => {
  it("parses a three-part version", () => {
    expect(parseVersion("307.4.2")).toEqual({ major: 307, minor: 4, patch: 2 });
  });

  it("parses 0.0.0", () => {
    expect(parseVersion("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("parses multi-digit patch numerically (not lexically)", () => {
    expect(parseVersion("306.0.10")).toEqual({
      major: 306,
      minor: 0,
      patch: 10,
    });
  });

  it("returns null for a non-version string", () => {
    expect(parseVersion("garbage")).toBeNull();
  });

  it("returns null when there are not exactly three parts", () => {
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3.4")).toBeNull();
  });

  it("returns null for the empty string", () => {
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  const v = (s: string) => parseVersion(s)!;

  it("returns 0 for equal versions", () => {
    expect(compareVersions(v("307.4.2"), v("307.4.2"))).toBe(0);
  });

  it("orders by major first", () => {
    expect(compareVersions(v("306.9.9"), v("307.0.0"))).toBeLessThan(0);
  });

  it("compares patch numerically, so 2 < 10", () => {
    expect(compareVersions(v("307.4.2"), v("307.4.10"))).toBeLessThan(0);
  });

  it("returns positive when the first is newer", () => {
    expect(compareVersions(v("307.4.7"), v("307.4.2"))).toBeGreaterThan(0);
  });
});

describe("evaluateGepHealth", () => {
  it("is red when the loaded version is the 0.0.0 manifest-outage stub", () => {
    const verdict = evaluateGepHealth({
      loadedVersion: "0.0.0",
      floor: "307.4.2",
    });
    expect(verdict.level).toBe("red");
  });

  it("is red when the binary is a stub even if the version string looks healthy", () => {
    const verdict = evaluateGepHealth({
      loadedVersion: "307.4.7",
      floor: "307.4.2",
      isStub: true,
    });
    expect(verdict.level).toBe("red");
  });

  it("is red when the loaded version is below the floor", () => {
    const verdict = evaluateGepHealth({
      loadedVersion: "306.0.10",
      floor: "307.4.2",
    });
    expect(verdict.level).toBe("red");
    expect(verdict.reason).toContain("307.4.2");
  });

  it("is green when the loaded version clears the floor", () => {
    expect(
      evaluateGepHealth({ loadedVersion: "307.4.7", floor: "307.4.2" }).level
    ).toBe("green");
  });

  it("is green when the loaded version equals the floor", () => {
    expect(
      evaluateGepHealth({ loadedVersion: "307.4.2", floor: "307.4.2" }).level
    ).toBe("green");
  });

  it("is warn when the version clears the floor but Overwolf reports augments degraded", () => {
    const verdict = evaluateGepHealth({
      loadedVersion: "307.4.7",
      floor: "307.4.2",
      augmentsState: 2,
    });
    expect(verdict.level).toBe("warn");
  });

  it("lets a below-floor red win over a degraded-feature warn", () => {
    const verdict = evaluateGepHealth({
      loadedVersion: "306.0.10",
      floor: "307.4.2",
      augmentsState: 2,
    });
    expect(verdict.level).toBe("red");
  });

  it("degrades to green when the floor is unknown (fetch failed)", () => {
    expect(
      evaluateGepHealth({ loadedVersion: "307.4.7", floor: null }).level
    ).toBe("green");
  });

  it("is green for a healthy version with augments green", () => {
    expect(
      evaluateGepHealth({
        loadedVersion: "307.4.7",
        floor: "307.4.2",
        augmentsState: 1,
      }).level
    ).toBe("green");
  });

  it("carries the loaded version and floor through in the verdict", () => {
    const verdict = evaluateGepHealth({
      loadedVersion: "306.0.10",
      floor: "307.4.2",
    });
    expect(verdict.loadedVersion).toBe("306.0.10");
    expect(verdict.floor).toBe("307.4.2");
  });
});

describe("fetchGepFloor", () => {
  const okFetcher =
    (body: unknown): FloorFetcher =>
    () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  const leagueBody = {
    game_id: 5426,
    state: 1,
    min_gep_version: "307.4.2",
    min_gep_version_electron: "307.4.2",
    features: [
      { name: "summoner_info", state: 1 },
      { name: "augments", state: 1 },
    ],
  };

  it("parses the electron floor, augments state, and top-level state", async () => {
    const floor = await fetchGepFloor(5426, okFetcher(leagueBody));
    expect(floor).toEqual({
      minGepVersionElectron: "307.4.2",
      augmentsState: 1,
      topLevelState: 1,
    });
  });

  it("targets the per-game prod status endpoint", async () => {
    let requested = "";
    const spy: FloorFetcher = (url) => {
      requested = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(leagueBody),
      });
    };
    await fetchGepFloor(5426, spy);
    expect(requested).toBe(gepStatusUrl(5426));
    expect(requested).toContain("5426_prod.json");
  });

  it("returns a null augments state when no augments feature is present", async () => {
    const floor = await fetchGepFloor(
      5426,
      okFetcher({
        min_gep_version_electron: "307.4.2",
        state: 1,
        features: [{ name: "summoner_info", state: 1 }],
      })
    );
    expect(floor?.augmentsState).toBeNull();
  });

  it("returns null when the floor field is missing", async () => {
    const floor = await fetchGepFloor(
      5426,
      okFetcher({ state: 1, features: [] })
    );
    expect(floor).toBeNull();
  });

  it("returns null when the response is not ok", async () => {
    const floor = await fetchGepFloor(5426, () =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    );
    expect(floor).toBeNull();
  });

  it("returns null when the fetcher throws", async () => {
    const floor = await fetchGepFloor(5426, () =>
      Promise.reject(new Error("network down"))
    );
    expect(floor).toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    const floor = await fetchGepFloor(5426, () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error("bad json")),
      })
    );
    expect(floor).toBeNull();
  });
});
