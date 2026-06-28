/**
 * Overwolf package-manifest guard.
 *
 * ow-electron resolves its native packages (GEP, overlay, utility) by fetching
 * a version manifest from Overwolf's package API. When that API regresses and
 * reports version "0.0.0" for every package (an Overwolf-side outage first seen
 * 2026-05-29), OWEPM downloads a 21 KB non-functional stub of GEP instead of
 * the real ~19 MB module. A stub GEP never fires `game-detected`, so in-game
 * augment events stop flowing and augment coaching silently dies, even though
 * the real package binaries remain hosted on Overwolf's CDN.
 *
 * This guard forces ow-electron onto the newest real GEP build being served.
 * On every launch where a live build can be resolved it serves a corrected
 * manifest on localhost pointing OWEPM straight at the real, still-hosted
 * binaries; `launch-electron.sh` hands that manifest to ow-electron via
 * `--owepm-packages-url`. It overrides unconditionally, not just on the
 * manifest's 0.0.0 outage signature: even after the manifest "recovers" to a
 * healthy version number, OWEPM's normal resolution re-downloads a ~21 KB stub
 * over a known-good cached binary on every launch (observed 2026-06-13, a
 * second app instance clobbered a real 306.0.10 cache back to a stub), so the
 * override has to be active each time to keep OWEPM on the real binary. The
 * guard stands down only when no live build can be found.
 *
 * The corrected manifest is built at serve time, not hard-coded: GEP's version
 * is auto-discovered against the CDN so the override always points at the
 * newest live build. League raises GEP's minimum-allowed version on every game
 * patch, so a fixed pin goes stale and GEP refuses to start its in-game
 * handler. See {@link discoverLatestVersion}.
 *
 * Modes:
 *   --check [--url U]   Resolve the newest served GEP (Overwolf manifest when
 *                       healthy, else CDN discovery). Exit 3 when a live build
 *                       is found (always override; OWEPM re-stubs without it),
 *                       1 when none can be resolved (treated by the launcher as
 *                       "do not override").
 *   --serve [--port N]  Discover live package versions, reconcile any stale
 *                       local GEP cache, then serve the override manifest on
 *                       127.0.0.1:N until killed.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  fetchGepFloor,
  evaluateGepHealth,
  parseVersion,
} from "../src/lib/gep-health";

// League of Legends Overwolf game id; used to read the published GEP floor.
const LOL_GAME_ID = 5426;

const DEFAULT_OVERWOLF_MANIFEST_URL =
  "https://electronapi.overwolf.com/packages";
const DEFAULT_PORT = 17865;
const CDN_BASE = "https://electrondl.overwolf.com";

const EXIT_ERROR = 1;
const EXIT_OVERRIDE_NEEDED = 3;

// A real GEP `.owepk` is ~19 MB; the broken Overwolf builds ship a ~21 KB stub
// that carries no in-game handler. Any cached package under this size is a stub
// and must be re-downloaded, even when its version string looks healthy.
const STUB_OWEPK_MAX_BYTES = 1_000_000;

// Key decisions are mirrored to a repo-local log file (resolved in the CLI
// entry) so a run can be double-checked after the fact, not just from the live
// terminal. Stays null when the module is imported (tests), so unit tests
// never touch disk.
let logSink: string | null = null;

function log(msg: string): void {
  console.error(`[ow-package-guard] ${msg}`);
  if (!logSink) return;
  try {
    appendFileSync(logSink, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // Best-effort: never let logging break the guard.
  }
}

/** Stable per-package OWEPM uids (constant across versions). */
export const GEP_UID = "hhideknibngookbhmhalphpipjeogcfefhobblkk";
export const UTILITY_UID = "jopghajpapbfooofklncedoalpgiaglgjaokpkon";
export const OVERLAY_UID = "emifmpeaagaaglhaimndbhcpkjfmjhfnjjpoibdo";

export interface OverwolfPackage {
  name: string;
  version: string;
  url: string;
  uid: string;
  phasing?: { phased: number };
}

export interface OverwolfPackagesManifest {
  packages: OverwolfPackage[];
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** A package as OWEPM has it on disk: uid plus the cached version. */
export interface InstalledPackage {
  uid: string;
  version: string;
}

/** Probes whether a given version string is downloadable on the CDN. */
export type VersionProbe = (version: string) => Promise<boolean>;

/** Yields a {@link VersionProbe} bound to a package's CDN channel. */
export type ProbeFactory = (channel: number) => VersionProbe;

export interface DiscoverOptions {
  /** Lowest version to consider; the maintained anchor for a package line. */
  baseline: Version;
  probe: VersionProbe;
  /** Consecutive misses tolerated before a version line is abandoned. */
  gapTolerance?: number;
  /** Highest patch probed within a single (major, minor) line. */
  patchCap?: number;
  /** How many minor lines above the baseline to also scan. */
  minorLookahead?: number;
  /** How many major lines above the baseline to also scan. */
  majorLookahead?: number;
}

interface PackageSpec {
  name: string;
  uid: string;
  channel: number;
  /** Preferred known-good version. Omitted for gep (always newest-live). */
  pin?: string;
  /** Anchor for discovery and pin-healing. */
  baseline: Version;
  /**
   * "always": resolve to the newest live build every launch (gep, so it keeps
   * clearing League's rising minimum-version floor).
   * "if-pin-dead": keep the pin while it is live (compat-stable for overlay and
   * utility, which must not outrun ow-electron); heal via discovery only if the
   * pin has been rotated off the CDN.
   */
  resolve: "always" | "if-pin-dead";
}

const PACKAGE_SPECS: readonly PackageSpec[] = [
  {
    name: "gep",
    uid: GEP_UID,
    channel: 1,
    baseline: { major: 306, minor: 0, patch: 0 },
    resolve: "always",
  },
  {
    name: "utility",
    uid: UTILITY_UID,
    channel: 2,
    pin: "2.7.5",
    baseline: { major: 2, minor: 7, patch: 5 },
    resolve: "if-pin-dead",
  },
  {
    name: "overlay",
    uid: OVERLAY_UID,
    channel: 3,
    pin: "1.12.5",
    baseline: { major: 1, minor: 12, patch: 5 },
    resolve: "if-pin-dead",
  },
];

// --- version helpers (internal) -------------------------------------------

function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function packageUrl(channel: number, version: string): string {
  return `${CDN_BASE}/${channel}/${version}/module.owepk`;
}

// --- discovery (STUB, implemented in the green step) ----------------------

/**
 * Finds the newest downloadable build at or above `baseline` by probing the
 * CDN. There is no version listing or "latest" alias while Overwolf's manifest
 * API is down, so this walks each (major, minor) line upward, tolerating the
 * leading gap left by rotated-off builds (e.g. 306.0.0/.1 are 403 while
 * 306.0.2/.3 are live), and also scans a few minor/major lines above the
 * baseline so a version bump is picked up without a code change. Returns null
 * if nothing is live near the baseline (caller should then skip the override
 * and log loudly rather than serve a dead URL).
 */
export async function discoverLatestVersion(
  opts: DiscoverOptions
): Promise<string | null> {
  const {
    baseline,
    probe,
    gapTolerance = 8,
    patchCap = 48,
    minorLookahead = 2,
    majorLookahead = 1,
  } = opts;

  const lines: Array<{ major: number; minor: number; startPatch: number }> = [
    {
      major: baseline.major,
      minor: baseline.minor,
      startPatch: baseline.patch,
    },
  ];
  for (let m = 1; m <= minorLookahead; m++) {
    lines.push({
      major: baseline.major,
      minor: baseline.minor + m,
      startPatch: 0,
    });
  }
  for (let M = 1; M <= majorLookahead; M++) {
    lines.push({ major: baseline.major + M, minor: 0, startPatch: 0 });
  }

  const perLine = await Promise.all(
    lines.map((line) => maxLiveInLine(line, probe, gapTolerance, patchCap))
  );
  const live = perLine.filter((v): v is Version => v !== null);
  if (live.length === 0) return null;
  live.sort(compareVersions);
  return formatVersion(live[live.length - 1]);
}

/** Highest live patch in one (major, minor) line, or null if none is live. */
async function maxLiveInLine(
  line: { major: number; minor: number; startPatch: number },
  probe: VersionProbe,
  gapTolerance: number,
  patchCap: number
): Promise<Version | null> {
  let best: Version | null = null;
  let misses = 0;
  for (
    let patch = line.startPatch;
    patch <= patchCap && misses <= gapTolerance;
    patch++
  ) {
    const candidate = { major: line.major, minor: line.minor, patch };
    if (await probe(formatVersion(candidate))) {
      best = candidate;
      misses = 0;
    } else {
      misses++;
    }
  }
  return best;
}

/** Fetches the live Overwolf package manifest, or null when it cannot be reached. */
export type ManifestFetcher = () => Promise<OverwolfPackagesManifest | null>;

async function fetchManifestSafe(
  url: string
): Promise<OverwolfPackagesManifest | null> {
  try {
    return await fetchOverwolfManifest(url);
  } catch (err) {
    log(`Overwolf manifest fetch failed: ${String(err)}`);
    return null;
  }
}

const defaultManifestFetcher: ManifestFetcher = () =>
  fetchManifestSafe(DEFAULT_OVERWOLF_MANIFEST_URL);

/**
 * Resolves the GEP version the override should serve: the single source of
 * truth for both `--check` and `--serve`, so the version the guard reports and
 * the one it actually serves never diverge.
 *
 * Prefers the version the recovered Overwolf manifest advertises, but only when
 * that exact build is downloadable on the CDN. The manifest can advertise a
 * build whose binary has not yet propagated, and during the 0.0.0 outage it
 * advertises a stub; in those cases, and when the manifest is unreachable, this
 * falls back to CDN baseline discovery so the guard still lands on a live build.
 * Returns null only when neither source yields one.
 *
 * Seeding from the manifest is what lets the override track League's rising
 * minimum-version floor without a hand-maintained baseline: CDN discovery alone
 * cannot reach a new (major, minor) line beyond its lookahead window once the
 * intervening line is a 403 gap (baseline 306.0.0 cannot see 307.4.x when the
 * whole 307.0.x line is rotated off).
 */
export async function resolveGepVersion(args: {
  baseline: Version;
  probe: VersionProbe;
  manifest: OverwolfPackagesManifest | null;
}): Promise<string | null> {
  const { baseline, probe, manifest } = args;
  // Test hook: GEP_FORCE_VERSION pins the override to a specific (CDN-live)
  // build so a stale-GEP restart can be exercised on demand, e.g. launching
  // with GEP_FORCE_VERSION=306.0.10 loads a below-floor build that the
  // "Restart now" flow then upgrades. Ignored when the build is not
  // downloadable, and unset by the launcher after the first launch so the
  // relaunch resolves the real latest.
  const forced = process.env.GEP_FORCE_VERSION;
  if (forced) {
    if (await probe(forced)) {
      log(
        `GEP_FORCE_VERSION=${forced} (test): serving this build, not the latest`
      );
      return forced;
    }
    log(`GEP_FORCE_VERSION=${forced} is not downloadable on the CDN; ignoring`);
  }
  if (manifest && !manifestIndicatesOutage(manifest)) {
    const advertised = manifest.packages?.find(
      (p) => p.name === "gep"
    )?.version;
    if (advertised && (await probe(advertised))) {
      return advertised;
    }
    if (advertised) {
      log(
        `Overwolf manifest advertises gep ${advertised} but the CDN has no such build; discovering via CDN`
      );
    }
  } else if (manifest) {
    log("Overwolf manifest is serving 0.0.0 stubs; discovering GEP via CDN");
  }
  return discoverLatestVersion({ baseline, probe });
}

/**
 * Builds the override manifest, resolving each package's version live: GEP to
 * the newest available build (it must clear League's current minimum-version
 * floor), overlay/utility to their compat-stable pins unless a pin has been
 * rotated off the CDN, in which case they heal upward. Returns null if GEP
 * cannot be resolved, since an override without a working GEP is pointless.
 */
export async function buildOverrideManifest(
  probeFactory: ProbeFactory = makeCdnProbeFactory(),
  fetchManifest: ManifestFetcher = defaultManifestFetcher
): Promise<OverwolfPackagesManifest | null> {
  const manifest = await fetchManifest();
  const packages: OverwolfPackage[] = [];
  for (const spec of PACKAGE_SPECS) {
    const probe = probeFactory(spec.channel);
    const version = await resolvePackageVersion(spec, probe, manifest);
    if (!version) {
      log(`could not resolve a live version for ${spec.name}`);
      if (spec.name === "gep") return null;
      continue;
    }
    packages.push({
      name: spec.name,
      uid: spec.uid,
      version,
      url: packageUrl(spec.channel, version),
      phasing: { phased: 100 },
    });
  }
  return packages.some((p) => p.name === "gep") ? { packages } : null;
}

async function resolvePackageVersion(
  spec: PackageSpec,
  probe: VersionProbe,
  manifest: OverwolfPackagesManifest | null
): Promise<string | null> {
  if (spec.resolve === "if-pin-dead" && spec.pin && (await probe(spec.pin))) {
    return spec.pin;
  }
  if (spec.resolve === "always") {
    return resolveGepVersion({ baseline: spec.baseline, probe, manifest });
  }
  return discoverLatestVersion({ baseline: spec.baseline, probe });
}

/** Local cache state for GEP: the extracted version plus whether the
 * downloaded `.owepk` is a stub (sub-megabyte placeholder). */
export interface GepCacheState {
  version: string;
  isStub: boolean;
}

export type GuardAction = "override-needed" | "cannot-resolve";

/**
 * Decides whether the launcher serves the override. While Overwolf's package
 * API is broken the override is served on EVERY launch a real build can be
 * resolved, not only when the local cache looks stale. OWEPM re-resolves GEP
 * against Overwolf's manifest each launch and currently re-downloads a ~21 KB
 * stub even over a known-good cached binary (observed 2026-06-13: a second
 * app instance clobbered a real 306.0.10 cache back to a stub the moment the
 * guard stepped aside). The only way to keep OWEPM on the real binary is to
 * point it at our override every time. `cannot-resolve` (no live build found)
 * is the sole no-override outcome, so the launcher never serves a dead override.
 */
export function decideGuardAction(args: {
  latestServed: string | null;
}): GuardAction {
  return args.latestServed ? "override-needed" : "cannot-resolve";
}

/**
 * Returns the uids of cached packages whose on-disk version differs from the
 * version the override will serve. Packages not part of the override are left
 * untouched.
 */
export function planCacheReconciliation(
  installed: InstalledPackage[],
  desired: InstalledPackage[]
): string[] {
  const desiredByUid = new Map(desired.map((d) => [d.uid, d.version]));
  return installed
    .filter(
      (i) => desiredByUid.has(i.uid) && desiredByUid.get(i.uid) !== i.version
    )
    .map((i) => i.uid);
}

// --- CDN probing ----------------------------------------------------------

function makeCdnProbeFactory(): ProbeFactory {
  return (channel) => async (version) => {
    try {
      // Ranged GET of 1 byte: live builds answer 200/206, rotated ones 403.
      const res = await fetch(packageUrl(channel, version), {
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}

// --- local package cache reconciliation -----------------------------------

/**
 * Resolves ow-electron's package cache directory under the Windows roaming
 * AppData (this guard runs in WSL against a Windows ow-electron). Returns the
 * `packages` dir that actually holds the GEP package, or null if it cannot be
 * located (reconciliation is then skipped, not forced).
 *
 * Honors `OW_ELECTRON_PACKAGES_DIR` for non-standard installs and tests.
 */
function resolvePackagesDir(): string | null {
  const override = process.env.OW_ELECTRON_PACKAGES_DIR;
  if (override) return existsSync(override) ? override : null;

  for (const root of candidateOwElectronRoots()) {
    if (!existsSync(root)) continue;
    for (const appHash of safeReaddir(root)) {
      const packagesDir = join(root, appHash, "packages");
      if (existsSync(join(packagesDir, `${GEP_UID}.owepk`))) {
        return packagesDir;
      }
    }
  }
  return null;
}

function candidateOwElectronRoots(): string[] {
  const roots: string[] = [];
  // WSL view of each Windows user's roaming AppData.
  const usersDir = "/mnt/c/Users";
  for (const user of safeReaddir(usersDir)) {
    roots.push(join(usersDir, user, "AppData", "Roaming", "ow-electron"));
  }
  // Native Windows / Electron-style fallbacks.
  const appData = process.env.APPDATA;
  if (appData) roots.push(join(appData, "ow-electron"));
  roots.push(join(homedir(), "AppData", "Roaming", "ow-electron"));
  return roots;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.endsWith(".bak-corrupted"));
  } catch {
    return [];
  }
}

/** Reads each cached package's uid and version (version = its extracted subdir). */
function readInstalledPackages(packagesDir: string): InstalledPackage[] {
  const installed: InstalledPackage[] = [];
  for (const spec of PACKAGE_SPECS) {
    if (!existsSync(join(packagesDir, `${spec.uid}.owepk`))) continue;
    const versions = safeReaddir(join(packagesDir, spec.uid));
    if (versions.length > 0) {
      installed.push({ uid: spec.uid, version: versions[0] });
    }
  }
  return installed;
}

/** A cached `.owepk` smaller than the stub ceiling is the broken placeholder. */
function isStubOwepk(owepkPath: string): boolean {
  try {
    return statSync(owepkPath).size < STUB_OWEPK_MAX_BYTES;
  } catch {
    return false;
  }
}

/**
 * Reads the cached GEP version (its extracted version subdir) and whether the
 * downloaded `.owepk` is a stub. Returns null when GEP is not cached or the
 * cache dir cannot be located, which the decision treats as "fetch it".
 */
function readCachedGep(packagesDir: string | null): GepCacheState | null {
  if (!packagesDir) return null;
  const owepk = join(packagesDir, `${GEP_UID}.owepk`);
  if (!existsSync(owepk)) return null;
  const versions = safeReaddir(join(packagesDir, GEP_UID));
  return { version: versions[0] ?? "", isStub: isStubOwepk(owepk) };
}

/**
 * Deletes any cached package whose on-disk version differs from the version the
 * override manifest will serve, so OWEPM re-downloads it instead of loading the
 * stale copy. Also force-purges GEP when its `.owepk` is a stub even if the
 * version matches, since a 0.0.0-era stub can sit under a real version dir.
 * No-op when the cache already matches and GEP is a real build.
 */
function reconcilePackageCache(
  packagesDir: string,
  desired: InstalledPackage[]
): void {
  const installed = readInstalledPackages(packagesDir);
  const purge = planCacheReconciliation(installed, desired);
  const gepOwepk = join(packagesDir, `${GEP_UID}.owepk`);
  if (
    !purge.includes(GEP_UID) &&
    existsSync(gepOwepk) &&
    isStubOwepk(gepOwepk)
  ) {
    purge.push(GEP_UID);
  }
  if (purge.length === 0) {
    log("local package cache already matches the override; nothing to purge");
    return;
  }
  const nameByUid = new Map(PACKAGE_SPECS.map((s) => [s.uid, s.name]));
  const oldByUid = new Map(installed.map((i) => [i.uid, i.version]));
  const newByUid = new Map(desired.map((d) => [d.uid, d.version]));
  for (const uid of purge) {
    rmSync(join(packagesDir, `${uid}.owepk`), { force: true });
    rmSync(join(packagesDir, uid), { recursive: true, force: true });
    const name = nameByUid.get(uid) ?? uid;
    log(
      `purged ${name} cache (${oldByUid.get(uid)} -> ${newByUid.get(uid)}); OWEPM will re-download`
    );
  }
}

// --- manifest probing / outage detection ----------------------------------

/**
 * True when the manifest shows the Overwolf outage signature: the GEP package
 * is present but pinned to the placeholder version "0.0.0". A healthy manifest
 * reports a real version such as "305.1.3".
 */
export function manifestIndicatesOutage(
  manifest: OverwolfPackagesManifest
): boolean {
  const gep = manifest.packages?.find((pkg) => pkg.name === "gep");
  return gep?.version === "0.0.0";
}

async function fetchOverwolfManifest(
  url: string
): Promise<OverwolfPackagesManifest> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  }
  return (await res.json()) as OverwolfPackagesManifest;
}

/**
 * Wraps an async resolver in a time-to-live cache. Within `ttlMs` of the last
 * successful resolve the cached value is returned without re-resolving; past it,
 * the resolver runs again. A resolve that returns null does not overwrite the
 * cache, so a transient failure keeps serving the last good value.
 *
 * The override server uses this so that an in-app relaunch (which re-fetches the
 * override but does not restart the long-lived guard process) picks up a build
 * newer than the one resolved at startup, e.g. after a League patch raises the
 * floor while the dev session is still running.
 */
export function createCachedResolver<T>(opts: {
  resolve: () => Promise<T | null>;
  ttlMs: number;
  now: () => number;
}): () => Promise<T | null> {
  let cached: { value: T; at: number } | null = null;
  return async () => {
    const t = opts.now();
    if (cached && t - cached.at < opts.ttlMs) return cached.value;
    const fresh = await opts.resolve();
    if (fresh !== null) cached = { value: fresh, at: t };
    return fresh ?? cached?.value ?? null;
  };
}

// The override server re-resolves at most this often: long enough to coalesce
// the burst of requests within one ow-electron launch, short enough that an
// in-app relaunch after a patch fetches a newer build on the next request.
const OVERRIDE_RESOLVE_TTL_MS = 15_000;

/**
 * Resolves the override manifest, reconciles the local cache against it, and
 * returns the JSON body to serve (null when no live GEP build can be resolved).
 * Run behind {@link createCachedResolver} so a re-resolve after a patch purges
 * the now-stale cache and serves the newer build to the next launch.
 */
async function resolveOverrideBody(): Promise<string | null> {
  const manifest = await buildOverrideManifest();
  if (!manifest) return null;
  try {
    const packagesDir = resolvePackagesDir();
    if (packagesDir) {
      reconcilePackageCache(
        packagesDir,
        manifest.packages.map((p) => ({ uid: p.uid, version: p.version }))
      );
    } else {
      log(
        "ow-electron package cache not found; skipping reconcile (OWEPM may load a stale GEP until its next update check)"
      );
    }
  } catch (err) {
    log(`cache reconcile failed, continuing: ${String(err)}`);
  }
  const versions = manifest.packages
    .map((p) => `${p.name}@${p.version}`)
    .join(", ");
  log(`resolved override manifest (${versions})`);
  return JSON.stringify(manifest);
}

async function serveOverrideManifest(port: number): Promise<void> {
  const getBody = createCachedResolver({
    resolve: resolveOverrideBody,
    ttlMs: OVERRIDE_RESOLVE_TTL_MS,
    now: () => Date.now(),
  });

  // Resolve once up front: fail fast if no GEP build exists, and reconcile the
  // cache before ow-electron starts.
  const initial = await getBody();
  if (!initial) {
    log(
      "no live GEP build found near baseline; not serving override (bump the gep baseline in PACKAGE_SPECS)"
    );
    process.exit(EXIT_ERROR);
  }

  const server = createServer((_req, res) => {
    void getBody().then((body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body ?? initial);
    });
  });
  server.listen(port, "127.0.0.1", () => {
    log(
      `serving override manifest on http://localhost:${port}/packages (re-resolves every ${OVERRIDE_RESOLVE_TTL_MS / 1000}s)`
    );
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * The newest real GEP build the override will serve, used by `--check` as the
 * target the local cache must match. Delegates to {@link resolveGepVersion} so
 * `--check` reports exactly the version `--serve` will build, never a manifest
 * value that bare CDN discovery cannot actually reach. Returns null only when
 * neither the manifest nor the CDN yields a version.
 */
async function resolveLatestServedGep(url: string): Promise<string | null> {
  const gep = PACKAGE_SPECS.find((s) => s.name === "gep");
  if (!gep) return null;
  return resolveGepVersion({
    baseline: gep.baseline,
    probe: makeCdnProbeFactory()(gep.channel),
    manifest: await fetchManifestSafe(url),
  });
}

/**
 * Decides whether the launcher serves the override. The trigger is simply
 * whether the latest served GEP build is resolvable: when it is, we override on
 * every launch (OWEPM re-stubs even a known-good cache otherwise, see
 * `decideGuardAction`). The local cache state is read only to log for
 * diagnostics, never to gate the decision.
 */
async function runCheck(url: string): Promise<number> {
  const latestServed = await resolveLatestServedGep(url);
  const cached = readCachedGep(resolvePackagesDir());
  const cacheDesc = cached
    ? cached.isStub
      ? `stub (${cached.version || "unextracted"})`
      : cached.version
    : "absent";

  if (decideGuardAction({ latestServed }) === "cannot-resolve") {
    log("could not determine the latest served GEP build; skipping override");
    return EXIT_ERROR;
  }
  await warnIfBelowFloor(latestServed);
  log(
    `serving override to the newest real GEP build [${latestServed}] (cache: ${cacheDesc}); OWEPM re-stubs without it`
  );
  return EXIT_OVERRIDE_NEEDED;
}

/**
 * Logs a loud warning when the build the override would serve is below League's
 * published floor, baking a floor cross-check into the per-launch drift log.
 * Soft: an unreachable floor endpoint is silently skipped, never a hard fail.
 */
async function warnIfBelowFloor(served: string | null): Promise<void> {
  if (!served) return;
  const floor = await fetchGepFloor(LOL_GAME_ID);
  if (!floor) return;
  const s = parseVersion(served);
  const f = parseVersion(floor.minGepVersionElectron);
  if (s && f && compareVersions(s, f) < 0) {
    log(
      `WARNING: served GEP ${served} is BELOW League's floor ${floor.minGepVersionElectron}; it will be rejected at game-attach and augments will not fire`
    );
  }
}

/**
 * Reads the cached GEP build and League's published floor and prints a pre-game
 * health verdict, so the guard-off live test (OWEPM_OVERRIDE_DISABLE=1) has a
 * single watchable command. Exit code: 0 green, 1 warn, 2 red.
 */
async function runHealthcheck(): Promise<number> {
  const cached = readCachedGep(resolvePackagesDir());
  const floor = await fetchGepFloor(LOL_GAME_ID);
  const floorStr = floor?.minGepVersionElectron ?? "unknown";

  if (!cached) {
    log(
      `healthcheck: no GEP cached yet; OWEPM will resolve on launch (floor ${floorStr})`
    );
    return 0;
  }

  const verdict = evaluateGepHealth({
    loadedVersion: cached.version || "0.0.0",
    floor: floor?.minGepVersionElectron ?? null,
    augmentsState: floor?.augmentsState ?? null,
    isStub: cached.isStub,
  });
  const cacheDesc = cached.isStub
    ? `stub (${cached.version || "unextracted"})`
    : cached.version || "unextracted";
  log(
    `healthcheck: ${verdict.level.toUpperCase()} (cached gep ${cacheDesc}, floor ${floorStr}): ${verdict.reason}`
  );
  return verdict.level === "green" ? 0 : verdict.level === "warn" ? 1 : 2;
}

function parsePort(args: string[]): number {
  const i = args.indexOf("--port");
  if (i !== -1 && args[i + 1]) {
    const p = Number(args[i + 1]);
    if (Number.isInteger(p) && p > 0) return p;
  }
  return DEFAULT_PORT;
}

function parseUrl(args: string[]): string {
  const i = args.indexOf("--url");
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return DEFAULT_OVERWOLF_MANIFEST_URL;
}

// CLI entry, guarded so importing this module (tests, launcher) is side-effect free.
const scriptPath = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] === scriptPath;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const mode = args.includes("--serve")
    ? "serve"
    : args.includes("--healthcheck")
      ? "healthcheck"
      : "check";
  // Resolved against the script path (not cwd) so it always lands at the repo
  // root regardless of where the guard is invoked from.
  logSink = join(dirname(scriptPath), "..", ".ow-guard.log");
  try {
    appendFileSync(
      logSink,
      `\n=== ow-package-guard --${mode} @ ${new Date().toISOString()} ===\n`
    );
  } catch {
    logSink = null; // not writable: fall back to console-only.
  }

  if (mode === "serve") {
    void serveOverrideManifest(parsePort(args));
  } else if (mode === "healthcheck") {
    void runHealthcheck().then((code) => process.exit(code));
  } else {
    void runCheck(parseUrl(args)).then((code) => process.exit(code));
  }
}
