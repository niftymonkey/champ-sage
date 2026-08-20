import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseShimPackageDir,
  inspectRuntime,
  evaluateRuntimeState,
  buildRepairCommand,
  buildInstallCommand,
  type RuntimeInspection,
} from "./ow-runtime-preflight";

const PNPM_SHIM_PATH =
  "C:\\Users\\markd\\AppData\\Local\\pnpm\\ow-electron.ps1";
const PNPM_PACKAGE_DIR =
  "C:\\Users\\markd\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\@overwolf+ow-electron@39.6.1\\node_modules\\@overwolf\\ow-electron";

// Verbatim excerpt of the pnpm-generated PowerShell shim: the cli.js path is
// relative to $basedir, and the NODE_PATH line mentions the same package under
// a `node_modules` suffix (which must not be mistaken for the package dir).
const PNPM_PS1_SHIM = `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
$new_node_path="C:\\Users\\markd\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\@overwolf+ow-electron@39.6.1\\node_modules\\@overwolf\\ow-electron\\node_modules;C:\\Users\\markd\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\node_modules"
if (Test-Path "$basedir/node$exe") {
  & "$basedir/node$exe"  "$basedir/global/5/.pnpm/@overwolf+ow-electron@39.6.1/node_modules/@overwolf/ow-electron/cli.js" $args
}
exit $ret
`;

// npm's global shim: no NODE_PATH line, package sits directly under the
// version's node_modules.
const NPM_PS1_SHIM = `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
if (Test-Path "$basedir/node$exe") {
  & "$basedir/node$exe"  "$basedir/node_modules/@overwolf/ow-electron/cli.js" $args
}
`;

// The .CMD twin uses %~dp0, which already carries a trailing backslash.
const PNPM_CMD_SHIM = `@SETLOCAL
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\global\\5\\.pnpm\\@overwolf+ow-electron@39.6.1\\node_modules\\@overwolf\\ow-electron\\cli.js" %*
)
`;

function makeInspection(
  overrides: Partial<RuntimeInspection> = {}
): RuntimeInspection {
  return {
    packageDirExists: true,
    installerExists: true,
    declaredVersion: "39.6.1",
    distVersion: "39.6.1",
    platformPathFile: "electron.exe",
    binaryExists: true,
    projectPinnedVersion: "39.6.1",
    ...overrides,
  };
}

describe("parseShimPackageDir", () => {
  it("resolves $basedir against the shim's own directory for a pnpm shim", () => {
    expect(parseShimPackageDir(PNPM_PS1_SHIM, PNPM_SHIM_PATH)).toBe(
      PNPM_PACKAGE_DIR
    );
  });

  it("resolves an npm global shim, whose package sits under $basedir/node_modules", () => {
    expect(
      parseShimPackageDir(
        NPM_PS1_SHIM,
        "C:\\Users\\markd\\AppData\\Local\\nvm\\v23.6.0\\ow-electron.ps1"
      )
    ).toBe(
      "C:\\Users\\markd\\AppData\\Local\\nvm\\v23.6.0\\node_modules\\@overwolf\\ow-electron"
    );
  });

  it("resolves %~dp0 in a .CMD shim without doubling the separator", () => {
    expect(
      parseShimPackageDir(
        PNPM_CMD_SHIM,
        "C:\\Users\\markd\\AppData\\Local\\pnpm\\ow-electron.CMD"
      )
    ).toBe(PNPM_PACKAGE_DIR);
  });

  it("returns null when the shim references no ow-electron cli.js", () => {
    expect(
      parseShimPackageDir("@echo off\nnode other.js\n", PNPM_SHIM_PATH)
    ).toBe(null);
  });

  it("returns null when the cli.js path holds a variable it cannot resolve", () => {
    const shim = `& node "$env:OW_HOME/node_modules/@overwolf/ow-electron/cli.js" $args`;
    expect(parseShimPackageDir(shim, PNPM_SHIM_PATH)).toBe(null);
  });
});

describe("evaluateRuntimeState", () => {
  it("reports healthy when the extracted runtime matches the declared version", () => {
    const state = evaluateRuntimeState(makeInspection());
    expect(state.level).toBe("healthy");
    expect(state.warnings).toEqual([]);
  });

  it("reports repairable when dist/ was deleted but install.js survives", () => {
    const state = evaluateRuntimeState(
      makeInspection({
        distVersion: null,
        platformPathFile: null,
        binaryExists: false,
      })
    );
    expect(state.level).toBe("repairable");
    expect(state.reason).toMatch(/runtime/i);
  });

  it("reports repairable when the extracted runtime is a different version", () => {
    const state = evaluateRuntimeState(
      makeInspection({ distVersion: "39.5.0" })
    );
    expect(state.level).toBe("repairable");
  });

  it("reports repairable when the binary is gone even though version files agree", () => {
    const state = evaluateRuntimeState(makeInspection({ binaryExists: false }));
    expect(state.level).toBe("repairable");
  });

  it("reports repairable when path.txt does not name the Windows binary", () => {
    const state = evaluateRuntimeState(
      makeInspection({ platformPathFile: "electron" })
    );
    expect(state.level).toBe("repairable");
  });

  it("tolerates a leading v on dist/version, as install.js does", () => {
    const state = evaluateRuntimeState(
      makeInspection({ distVersion: "v39.6.1" })
    );
    expect(state.level).toBe("healthy");
    expect(state.warnings).toEqual([]);
  });

  it("reports unrecoverable when the package directory is missing entirely", () => {
    const state = evaluateRuntimeState(
      makeInspection({
        packageDirExists: false,
        installerExists: false,
        declaredVersion: null,
        distVersion: null,
        platformPathFile: null,
        binaryExists: false,
      })
    );
    expect(state.level).toBe("unrecoverable");
  });

  it("reports unrecoverable when install.js itself is missing", () => {
    const state = evaluateRuntimeState(
      makeInspection({ installerExists: false, binaryExists: false })
    );
    expect(state.level).toBe("unrecoverable");
  });

  it("reports unrecoverable when package.json declares no version to install", () => {
    const state = evaluateRuntimeState(
      makeInspection({ declaredVersion: null, binaryExists: false })
    );
    expect(state.level).toBe("unrecoverable");
  });

  it("warns when the global runtime is older than the version the project pins", () => {
    const state = evaluateRuntimeState(
      makeInspection({
        declaredVersion: "39.6.1",
        distVersion: "39.6.1",
        projectPinnedVersion: "39.8.13",
      })
    );
    expect(state.level).toBe("healthy");
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toContain("39.8.13");
  });

  it("does not warn when the global runtime is newer than the pin", () => {
    const state = evaluateRuntimeState(
      makeInspection({
        declaredVersion: "39.8.13",
        distVersion: "39.8.13",
        projectPinnedVersion: "39.6.1",
      })
    );
    expect(state.warnings).toEqual([]);
  });
});

describe("buildRepairCommand", () => {
  it("re-runs the package's own installer from the package directory", () => {
    expect(buildRepairCommand("C:\\pnpm\\global\\ow-electron")).toBe(
      "Set-Location -LiteralPath 'C:\\pnpm\\global\\ow-electron'; node install.js"
    );
  });

  it("escapes apostrophes so a path like C:\\Users\\O'Neil stays one argument", () => {
    expect(buildRepairCommand("C:\\Users\\O'Neil\\ow-electron")).toBe(
      "Set-Location -LiteralPath 'C:\\Users\\O''Neil\\ow-electron'; node install.js"
    );
  });
});

describe("buildInstallCommand", () => {
  it("names the exact global install to run when nothing is repairable", () => {
    expect(buildInstallCommand("39.6.1")).toBe(
      "npm install -g @overwolf/ow-electron@39.6.1"
    );
  });
});

describe("inspectRuntime", () => {
  // install.js reads `owElectronVersion` and nothing else (see its
  // isInstalled()), so an npm `version` field must not stand in for it: a
  // package that carries only `version` has no runtime version to install.
  function writePackage(
    manifest: Record<string, string>,
    extras: { installer?: boolean; distVersion?: string } = {}
  ): string {
    const dir = mkdtempSync(join(tmpdir(), "ow-runtime-preflight-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    if (extras.installer !== false) writeFileSync(join(dir, "install.js"), "");
    writeFileSync(join(dir, "path.txt"), "electron.exe");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "version"), extras.distVersion ?? "39.6.1");
    writeFileSync(join(dir, "dist", "electron.exe"), "");
    return dir;
  }

  it("reads owElectronVersion as the runtime version to install", () => {
    const dir = writePackage({
      version: "39.6.1",
      owElectronVersion: "39.6.1",
    });
    expect(inspectRuntime(dir, "39.6.1").declaredVersion).toBe("39.6.1");
  });

  it("finds no runtime version when the manifest carries only npm's version", () => {
    const dir = writePackage({ version: "39.6.1" });
    expect(inspectRuntime(dir, "39.6.1").declaredVersion).toBeNull();
  });

  it("treats a blank owElectronVersion as no version at all", () => {
    const dir = writePackage({ owElectronVersion: "   ", version: "39.6.1" });
    expect(inspectRuntime(dir, "39.6.1").declaredVersion).toBeNull();
  });

  // The whole point of the two tests above: a version-only manifest must reach
  // the unrecoverable verdict (exit 3) rather than passing as healthy because
  // dist/version happens to match the npm package version.
  it("ends in unrecoverable for a version-only manifest whose dist matches it", () => {
    const dir = writePackage({ version: "39.6.1" });
    const state = evaluateRuntimeState(inspectRuntime(dir, "39.6.1"));
    expect(state.level).toBe("unrecoverable");
    expect(state.reason).toContain("owElectronVersion");
  });
});
