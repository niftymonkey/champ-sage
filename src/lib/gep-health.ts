/**
 * GEP health evaluation: the pure, dependency-light core shared by the guard
 * CLI (`scripts/ow-package-guard.ts`), the Electron main process
 * (`electron/main.ts`), and the renderer banner.
 *
 * The premise: GEP can load successfully yet be silently rejected at
 * game-attach when its version is below League's current floor (or when it is
 * a stub). No GEP/OWEPM event fires for that rejection, so the app cannot learn
 * it from a callback. But Overwolf publishes the floor on a public per-game
 * status endpoint, readable before a game is queued, so health can be PREDICTED
 * pre-queue: compare the loaded GEP version against the floor (and check it is
 * not a stub). This turns the silent failure into a loud warning.
 *
 * See `docs/research/gep-version-drift-recommendation.md` and
 * `docs/reference/technical-reference.md` ("GEP package resolution").
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Stable OWEPM uid for the GEP package, constant across versions. Used to
 * locate the cached `.owepk` on disk. Mirrors the constant in
 * `scripts/ow-package-guard.ts` (the guard resolves it from the WSL view of the
 * cache; the Electron main process resolves it from the Windows view).
 */
export const GEP_UID = "hhideknibngookbhmhalphpipjeogcfefhobblkk";

export type GepHealthLevel = "green" | "warn" | "red";

/**
 * A pre-queue verdict on whether GEP will attach and augment events will flow.
 * `red` means augments will be silently unavailable this game; `warn` means
 * Overwolf reports the augments feature itself is degraded platform-side;
 * `green` means no problem was detected (which is a prediction, not a proof).
 */
export interface GepHealthVerdict {
  level: GepHealthLevel;
  reason: string;
  loadedVersion: string;
  floor: string | null;
}

/**
 * League's GEP floor and feature health, parsed from Overwolf's per-game
 * status endpoint. `augmentsState` follows Overwolf's convention
 * (0 unsupported, 1 green, 2 yellow, 3 red); null when the field is absent.
 */
export interface GepFloor {
  /** The ow-electron floor (`min_gep_version_electron`); prefer this over the native `min_gep_version`. */
  minGepVersionElectron: string;
  augmentsState: number | null;
  topLevelState: number | null;
}

/** Minimal fetch surface, injectable so the parse logic is unit-testable. */
export type FloorFetcher = (
  url: string
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Overwolf's public, no-auth per-game GEP status endpoint. */
export function gepStatusUrl(gameId: number): string {
  return `https://game-events-status.overwolf.com/${gameId}_prod.json`;
}

/** Parses a strict three-part numeric version (e.g. "307.4.2"); null otherwise. */
export function parseVersion(value: string): Version | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return { major: nums[0], minor: nums[1], patch: nums[2] };
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Predicts whether GEP will attach and augment events will flow, from signals
 * available before a game is queued. Order matters: a stub or below-floor build
 * is `red` (augments will be silently rejected) regardless of feature health; a
 * cleared floor with a platform-degraded augments feature is `warn`; otherwise
 * `green`. A `green` verdict is a prediction, not a proof: an unknown floor
 * (the fetch failed) or an unparseable version degrades to `green` rather than
 * crying wolf, since the runtime non-attach detector is the loud backstop.
 */
export function evaluateGepHealth(args: {
  loadedVersion: string;
  floor: string | null;
  augmentsState?: number | null;
  isStub?: boolean;
}): GepHealthVerdict {
  const { loadedVersion, floor, augmentsState, isStub } = args;
  const base = { loadedVersion, floor };

  if (loadedVersion === "0.0.0") {
    return {
      ...base,
      level: "red",
      reason:
        "GEP manifest outage (0.0.0 stub): augment coaching unavailable this game.",
    };
  }

  if (isStub) {
    return {
      ...base,
      level: "red",
      reason:
        "GEP binary is a stub (incomplete download): augment coaching unavailable this game.",
    };
  }

  const loaded = parseVersion(loadedVersion);
  const floorVersion = floor !== null ? parseVersion(floor) : null;
  if (loaded && floorVersion && compareVersions(loaded, floorVersion) < 0) {
    return {
      ...base,
      level: "red",
      reason: `GEP v${loadedVersion} is below League's required v${floor}: augment coaching unavailable until it updates.`,
    };
  }

  if (
    augmentsState !== null &&
    augmentsState !== undefined &&
    augmentsState !== 1
  ) {
    return {
      ...base,
      level: "warn",
      reason:
        "Overwolf reports the augments feature is degraded: augment coaching may be unreliable this game.",
    };
  }

  return { ...base, level: "green", reason: "GEP clears League's floor." };
}

interface RawGepStatus {
  state?: unknown;
  min_gep_version_electron?: unknown;
  features?: Array<{ name?: unknown; state?: unknown }>;
}

/**
 * Reads League's GEP floor and feature health from Overwolf's public per-game
 * status endpoint. This is a SEPARATE service from the package manifest, so it
 * stays usable as a floor signal during a manifest outage. Returns null on any
 * failure (unreachable, non-ok, malformed, or missing floor field) so callers
 * degrade to "floor unknown" rather than hard-failing.
 */
export async function fetchGepFloor(
  gameId: number,
  fetcher: FloorFetcher = fetch
): Promise<GepFloor | null> {
  try {
    const res = await fetcher(gepStatusUrl(gameId));
    if (!res.ok) return null;
    const body = (await res.json()) as RawGepStatus;
    const floor = body.min_gep_version_electron;
    if (typeof floor !== "string" || floor.length === 0) return null;
    const augments = body.features?.find((f) => f.name === "augments");
    return {
      minGepVersionElectron: floor,
      augmentsState:
        typeof augments?.state === "number" ? augments.state : null,
      topLevelState: typeof body.state === "number" ? body.state : null,
    };
  } catch {
    return null;
  }
}
