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
 * This guard detects that specific outage and, only when it is happening,
 * serves a corrected manifest on localhost that points OWEPM straight at the
 * real, still-hosted binaries. `launch-electron.sh` hands that manifest to
 * ow-electron via `--owepm-packages-url`. When Overwolf's API is healthy the
 * guard does nothing and ow-electron resolves packages the normal way.
 *
 * The corrected manifest is built at serve time, not hard-coded: GEP's version
 * is auto-discovered against the CDN so the override always points at the
 * newest live build. League raises GEP's minimum-allowed version on every game
 * patch, so a fixed pin goes stale and GEP refuses to start its in-game
 * handler. See {@link discoverLatestVersion}.
 *
 * Modes:
 *   --check [--url U]   Probe Overwolf's manifest (U defaults to production).
 *                       Exit 3 when the 0.0.0 outage is detected (override
 *                       needed), 0 when healthy, 1 on any error (treated by the
 *                       launcher as "do not override").
 *   --serve [--port N]  Discover live package versions, reconcile any stale
 *                       local GEP cache, then serve the override manifest on
 *                       127.0.0.1:N until killed.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_OVERWOLF_MANIFEST_URL =
  "https://electronapi.overwolf.com/packages";
const DEFAULT_PORT = 17865;
const CDN_BASE = "https://electrondl.overwolf.com";

const EXIT_HEALTHY = 0;
const EXIT_ERROR = 1;
const EXIT_OVERRIDE_NEEDED = 3;

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

/**
 * Builds the override manifest, resolving each package's version live: GEP to
 * the newest available build (it must clear League's current minimum-version
 * floor), overlay/utility to their compat-stable pins unless a pin has been
 * rotated off the CDN, in which case they heal upward. Returns null if GEP
 * cannot be resolved, since an override without a working GEP is pointless.
 */
export async function buildOverrideManifest(
  probeFactory: ProbeFactory = makeCdnProbeFactory()
): Promise<OverwolfPackagesManifest | null> {
  const packages: OverwolfPackage[] = [];
  for (const spec of PACKAGE_SPECS) {
    const probe = probeFactory(spec.channel);
    const version = await resolvePackageVersion(spec, probe);
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
  probe: VersionProbe
): Promise<string | null> {
  if (spec.resolve === "if-pin-dead" && spec.pin && (await probe(spec.pin))) {
    return spec.pin;
  }
  return discoverLatestVersion({ baseline: spec.baseline, probe });
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

/**
 * Deletes any cached package whose on-disk version differs from the version the
 * override manifest will serve, so OWEPM re-downloads it instead of loading the
 * stale copy. No-op when the cache already matches.
 */
function reconcilePackageCache(
  packagesDir: string,
  desired: InstalledPackage[]
): void {
  const installed = readInstalledPackages(packagesDir);
  const purge = planCacheReconciliation(installed, desired);
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

async function serveOverrideManifest(port: number): Promise<void> {
  const manifest = await buildOverrideManifest();
  if (!manifest) {
    log(
      "no live GEP build found near baseline; not serving override (bump the gep baseline in PACKAGE_SPECS)"
    );
    process.exit(EXIT_ERROR);
  }

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

  const body = JSON.stringify(manifest);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  server.listen(port, "127.0.0.1", () => {
    const versions = manifest.packages
      .map((p) => `${p.name}@${p.version}`)
      .join(", ");
    log(
      `serving override manifest on http://localhost:${port}/packages (${versions})`
    );
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runCheck(url: string): Promise<number> {
  try {
    const manifest = await fetchOverwolfManifest(url);
    if (manifestIndicatesOutage(manifest)) {
      log("Overwolf manifest is serving 0.0.0 stubs: override needed");
      return EXIT_OVERRIDE_NEEDED;
    }
    log("Overwolf manifest healthy: no override");
    return EXIT_HEALTHY;
  } catch (err) {
    log(`check failed, skipping override: ${String(err)}`);
    return EXIT_ERROR;
  }
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
  const mode = args.includes("--serve") ? "serve" : "check";
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
  } else {
    void runCheck(parseUrl(args)).then((code) => process.exit(code));
  }
}
