/**
 * ow-electron runtime preflight.
 *
 * `pnpm dev:electron` does not run Electron from this repo. It shells out to
 * the Windows-side GLOBAL `ow-electron` (a WSL-local install would fetch the
 * Linux runtime, and running a 212 MB Windows binary over `\\wsl$` is slow and
 * hits the documented Chromium cache-lock class). That global install is a
 * plain npm/pnpm package whose `postinstall` downloads and extracts the actual
 * ~327 MB Electron runtime into `dist/`.
 *
 * When that `dist/` tree goes missing, `pnpm dev:electron` dies on
 * "Electron failed to install correctly" before any window exists (observed
 * 2026-08-17; see docs/reference/upstream-changes.md). It is not a one-off: the
 * pnpm global store has `ignoredBuilds` active, so a future
 * `pnpm add -g @overwolf/ow-electron` upgrade can legitimately skip
 * `install.js` and leave exactly this dist-less state.
 *
 * This preflight runs before the launch loop, checks the same three things
 * `install.js` itself checks (`dist/version`, `path.txt`, the binary), and
 * re-runs the package's own installer when they disagree. `install.js` is
 * idempotent and the source zip is normally still in the Electron download
 * cache, so a repair is usually extract-only.
 *
 * Modes:
 *   (default)   inspect, repair if needed, verify.
 *   --check     inspect and report only, never repair.
 *
 * Exit codes:
 *   0  runtime is usable (healthy, or repaired successfully)
 *   2  `--check` only: a repair is needed and was not attempted
 *   3  runtime unusable and not repairable here; the exact manual command is
 *      printed. The launcher must not launch.
 *   1  preflight could not determine anything (no shim, unparseable shim, its
 *      own crash). The launcher warns and launches anyway rather than refusing
 *      to start because its helper broke.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compareVersions, parseVersion } from "../src/lib/gep-health";

/** What `install.js` writes into `path.txt` on Windows. */
const WINDOWS_BINARY = "electron.exe";

export const EXIT_HEALTHY = 0;
export const EXIT_UNKNOWN = 1;
export const EXIT_REPAIR_NEEDED = 2;
export const EXIT_UNRECOVERABLE = 3;

/** The on-disk facts the decision is made from, all read by the runner. */
export interface RuntimeInspection {
  packageDirExists: boolean;
  /** `install.js`, the package's own runtime installer. */
  installerExists: boolean;
  /** `owElectronVersion` from the package's package.json: what should be extracted. */
  declaredVersion: string | null;
  /** `dist/version`: what actually is extracted. */
  distVersion: string | null;
  /** `path.txt`: which binary inside `dist/` to run. */
  platformPathFile: string | null;
  binaryExists: boolean;
  /** The version this repo pins in devDependencies, for a drift warning. */
  projectPinnedVersion: string | null;
}

export type RuntimeLevel = "healthy" | "repairable" | "unrecoverable";

export interface RuntimeState {
  level: RuntimeLevel;
  reason: string;
  /** Non-blocking notes (version drift against the project pin). */
  warnings: string[];
}

/** Splits a Windows or POSIX path, returning everything before the last separator. */
function parentDir(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

/** Collapses mixed and duplicated separators, preserving a leading UNC `\\`. */
function toWindowsPath(path: string): string {
  const unc = /^[\\/]{2}/.test(path);
  const collapsed = path.replace(/[\\/]+/g, "\\");
  return unc ? `\\${collapsed}` : collapsed;
}

/**
 * Finds the ow-electron package directory from the text of its command shim.
 *
 * Every shim generator (pnpm's .ps1/.CMD, npm's) writes the absolute path of
 * `@overwolf/ow-electron/cli.js` relative to a base-dir variable that is the
 * shim's own directory. Reading the shim is how we find the package without
 * shelling to `pnpm`, which is no longer on the Windows PATH here. The pnpm
 * shim also embeds a NODE_PATH pointing at the same package plus a
 * `node_modules` suffix, so the cli.js reference is the one to anchor on.
 */
export function parseShimPackageDir(
  shimText: string,
  shimPath: string
): string | null {
  const match = shimText.match(
    /"([^"\n]*?@overwolf[\\/]ow-electron[\\/]cli\.js)"/i
  );
  if (!match) return null;

  const shimDir = parentDir(toWindowsPath(shimPath));
  // `%~dp0` already carries a trailing separator; `toWindowsPath` collapses the
  // duplicate that produces.
  const resolved = match[1]
    .replace(/\$basedir/gi, shimDir)
    .replace(/%~dp0/gi, `${shimDir}\\`);

  // An unresolved variable means the package lives somewhere only the shell
  // knows; guessing would be worse than reporting "unknown".
  if (/[$%]/.test(resolved)) return null;

  return toWindowsPath(resolved).replace(/\\cli\.js$/i, "");
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, "");
}

/**
 * Decides whether the extracted runtime is usable, repairable by re-running the
 * package's own installer, or beyond this script's reach.
 *
 * The healthy conditions mirror `install.js`'s own `isInstalled()` exactly, so
 * "healthy" here means "install.js would exit early", i.e. a repair is a no-op.
 */
export function evaluateRuntimeState(
  inspection: RuntimeInspection
): RuntimeState {
  const {
    packageDirExists,
    installerExists,
    declaredVersion,
    distVersion,
    platformPathFile,
    binaryExists,
    projectPinnedVersion,
  } = inspection;

  const warnings: string[] = [];
  const declared = declaredVersion ? parseVersion(declaredVersion) : null;
  const pinned = projectPinnedVersion
    ? parseVersion(projectPinnedVersion)
    : null;
  if (declared && pinned && compareVersions(declared, pinned) < 0) {
    warnings.push(
      `global ow-electron is ${declaredVersion} but this project pins ${projectPinnedVersion}; upgrade with 'npm install -g @overwolf/ow-electron@${projectPinnedVersion}'`
    );
  }

  const versionsAgree =
    !!declaredVersion &&
    !!distVersion &&
    normalizeVersion(distVersion) === normalizeVersion(declaredVersion);
  const pathFileOk = platformPathFile?.trim() === WINDOWS_BINARY;

  if (versionsAgree && pathFileOk && binaryExists) {
    return {
      level: "healthy",
      reason: `Electron runtime ${normalizeVersion(distVersion!)} is extracted and complete`,
      warnings,
    };
  }

  if (!packageDirExists) {
    return {
      level: "unrecoverable",
      reason: "the global ow-electron package directory does not exist",
      warnings,
    };
  }
  if (!installerExists) {
    return {
      level: "unrecoverable",
      reason:
        "the global ow-electron package has no install.js, so its runtime cannot be re-extracted",
      warnings,
    };
  }
  if (!declaredVersion) {
    return {
      level: "unrecoverable",
      reason:
        "the global ow-electron package.json declares no owElectronVersion, so there is no runtime version to install",
      warnings,
    };
  }

  let reason: string;
  if (!distVersion) {
    reason = "the extracted Electron runtime is missing (no dist/version)";
  } else if (!versionsAgree) {
    reason = `the extracted Electron runtime is ${normalizeVersion(distVersion)} but the package declares ${normalizeVersion(declaredVersion)}`;
  } else if (!pathFileOk) {
    reason = `path.txt names '${platformPathFile?.trim() ?? ""}' rather than the Windows runtime binary ${WINDOWS_BINARY}`;
  } else {
    reason = `the Electron runtime binary ${WINDOWS_BINARY} is absent from dist/`;
  }
  return { level: "repairable", reason, warnings };
}

/**
 * The PowerShell one-liner that re-extracts the runtime. Printed verbatim when
 * an automatic repair fails, so the manual step is copy-pasteable.
 */
export function buildRepairCommand(packageDirWin: string): string {
  const escaped = packageDirWin.replace(/'/g, "''");
  return `Set-Location -LiteralPath '${escaped}'; node install.js`;
}

/** The manual global install to run when there is nothing left to repair. */
export function buildInstallCommand(version: string): string {
  return `npm install -g @overwolf/ow-electron@${version}`;
}

// ---------------------------------------------------------------------------
// Runner (thin I/O around the pure core above)
// ---------------------------------------------------------------------------

const PREFIX = "[ow-runtime-preflight]";

function log(msg: string): void {
  console.error(`${PREFIX} ${msg}`);
}

function powershell(command: string, timeoutMs: number): string {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf-8", timeout: timeoutMs, cwd: "/mnt/c" }
  );
}

/** Windows path -> WSL path, so the runtime can be inspected with plain fs. */
function toWslPath(windowsPath: string): string | null {
  try {
    return execFileSync("wslpath", ["-u", windowsPath], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Where the Windows PATH resolves `ow-electron`.
 *
 * `asked` separates "Windows answered, and ow-electron is not installed" from
 * "we never got to ask": WSL's interop socket times out from time to time
 * (`UtilAcceptVsock: accept4 failed 110`, seen while Vite and tsup were both
 * starting), and treating that as a missing install would block a launch that
 * would have worked.
 */
interface ShimLookup {
  asked: boolean;
  source: string | null;
}

function resolveShimPath(): ShimLookup {
  const query =
    "(Get-Command ow-electron -ErrorAction SilentlyContinue | Select-Object -First 1).Source";
  // One retry, because the interop failure is transient by nature.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { asked: true, source: powershell(query, 15_000).trim() || null };
    } catch (err) {
      if (attempt === 1) {
        log(
          `could not ask Windows where ow-electron is: ${err instanceof Error ? err.message : err}`
        );
        return { asked: false, source: null };
      }
    }
  }
  return { asked: false, source: null };
}

/** The version this repo pins, with the range prefix stripped. */
function readProjectPin(repoRoot: string): string | null {
  const raw = readFileOrNull(join(repoRoot, "package.json"));
  if (!raw) return null;
  try {
    const pkg: { devDependencies?: Record<string, string> } = JSON.parse(raw);
    const range = pkg.devDependencies?.["@overwolf/ow-electron"];
    return range ? range.replace(/^[^0-9]*/, "") || null : null;
  } catch {
    return null;
  }
}

function inspectRuntime(
  packageDirWsl: string,
  projectPinnedVersion: string | null
): RuntimeInspection {
  const packageJson = readFileOrNull(join(packageDirWsl, "package.json"));
  let declaredVersion: string | null = null;
  if (packageJson) {
    try {
      const parsed: { owElectronVersion?: string; version?: string } =
        JSON.parse(packageJson);
      declaredVersion = parsed.owElectronVersion ?? parsed.version ?? null;
    } catch {
      declaredVersion = null;
    }
  }

  const platformPathFile = readFileOrNull(join(packageDirWsl, "path.txt"));
  const binaryName = platformPathFile?.trim() || WINDOWS_BINARY;

  return {
    packageDirExists: existsSync(packageDirWsl),
    installerExists: existsSync(join(packageDirWsl, "install.js")),
    declaredVersion,
    distVersion: readFileOrNull(join(packageDirWsl, "dist", "version")),
    platformPathFile,
    binaryExists: existsSync(join(packageDirWsl, "dist", binaryName)),
    projectPinnedVersion,
  };
}

function reportWarnings(state: RuntimeState): void {
  for (const warning of state.warnings) log(`WARNING: ${warning}`);
}

function main(): number {
  const checkOnly = process.argv.includes("--check");
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  const shim = resolveShimPath();
  if (!shim.asked) {
    log("WARNING: skipping the runtime check (Windows was unreachable)");
    return EXIT_UNKNOWN;
  }
  const shimPath = shim.source;
  if (!shimPath) {
    const pin = readProjectPin(repoRoot);
    log(
      "ERROR: ow-electron is not on the Windows PATH. Install it globally on Windows:"
    );
    log(`  ${buildInstallCommand(pin ?? "latest")}`);
    return EXIT_UNRECOVERABLE;
  }

  const shimWslPath = toWslPath(shimPath);
  const shimText = shimWslPath ? readFileOrNull(shimWslPath) : null;
  const packageDirWin = shimText
    ? parseShimPackageDir(shimText, shimPath)
    : null;
  const packageDirWsl = packageDirWin ? toWslPath(packageDirWin) : null;
  if (!packageDirWin || !packageDirWsl) {
    log(
      `WARNING: could not locate the ow-electron package from its shim (${shimPath}); skipping the runtime check`
    );
    return EXIT_UNKNOWN;
  }

  const pin = readProjectPin(repoRoot);
  const inspection = inspectRuntime(packageDirWsl, pin);
  const state = evaluateRuntimeState(inspection);
  reportWarnings(state);

  if (state.level === "healthy") {
    log(state.reason);
    return EXIT_HEALTHY;
  }

  if (state.level === "unrecoverable") {
    log(`ERROR: ${state.reason}`);
    log("Reinstall the Windows global runtime, then retry:");
    log(
      `  ${buildInstallCommand(inspection.declaredVersion ?? pin ?? "latest")}`
    );
    return EXIT_UNRECOVERABLE;
  }

  const repairCommand = buildRepairCommand(packageDirWin);
  if (checkOnly) {
    log(`repair needed: ${state.reason}`);
    log(`  powershell.exe -NoProfile -Command "${repairCommand}"`);
    return EXIT_REPAIR_NEEDED;
  }

  log(`${state.reason}; re-extracting it (this can take a few minutes)...`);
  try {
    // Inherit stdio: install.js prints download/extract progress, and a silent
    // multi-minute stall during launch is exactly the experience being fixed.
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", repairCommand],
      { stdio: "inherit", timeout: 600_000, cwd: "/mnt/c" }
    );
  } catch (err) {
    log(`repair command failed: ${err instanceof Error ? err.message : err}`);
  }

  const after = evaluateRuntimeState(inspectRuntime(packageDirWsl, pin));
  if (after.level === "healthy") {
    log(`repaired: ${after.reason}`);
    return EXIT_HEALTHY;
  }

  log(`ERROR: runtime still unusable after repair (${after.reason}).`);
  log("Run this in a Windows shell, then retry:");
  log(`  powershell.exe -NoProfile -Command "${repairCommand}"`);
  return EXIT_UNRECOVERABLE;
}

// CLI entry, guarded so importing this module (tests) is side-effect free.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    // A preflight that breaks must not be the reason the app does not start.
    log(`crashed: ${err instanceof Error ? err.stack : err}`);
    process.exit(EXIT_UNKNOWN);
  }
}
