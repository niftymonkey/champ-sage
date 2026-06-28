#!/bin/bash
# Launch Electron from WSL2 via the Windows-side ow-electron binary.
#
# Prerequisites: install ow-electron globally on Windows:
#   npm install -g @overwolf/ow-electron
#
# Modes:
#   (default)  dev   wait for Vite dev server, set VITE_DEV_SERVER_URL
#   --prod           load bundled HTML files from dist/, no dev server
#
# Derives the Windows path from the repo root automatically via wslpath,
# so this works regardless of where the repo is cloned.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PROJECT_WIN="$(wslpath -w "${PROJECT_ROOT}")"

# Change to a Windows-compatible directory before running powershell.exe to avoid UNC path warnings
cd /mnt/c || { echo "[launch-electron] Error: Cannot change to /mnt/c"; exit 1; }

UTF8='[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'

# Best-effort: kill orphan ow-electron / electron processes from prior dev
# runs against THIS repo. concurrently sometimes can't reap ow-electron
# cleanly on Ctrl-C (GEP / overlay packages keep it alive), and a leftover
# instance holds exclusive locks on Chromium's Cache / Code Cache / GPUCache
# under userData, so the next launch prints "Unable to move the cache:
# Access is denied" repeatedly. Filtering on command-line containing the
# repo's Windows path means unrelated ow-electron apps are not touched.
sweep_orphans() {
  # Pass PROJECT_WIN via env var (not single-quoted interpolation) and use
  # [WildcardPattern]::Escape() to neutralize apostrophes and wildcard
  # metacharacters (* ? [ ]) before building the -like pattern, so paths
  # like "C:\Users\O'Neil\repo[dev]" don't break parsing or accidentally
  # match unrelated processes.
  REPO_WIN_PATH="${PROJECT_WIN}" powershell.exe -NoProfile -Command "\$path = \$env:REPO_WIN_PATH; \$pattern = '*' + [System.Management.Automation.WildcardPattern]::Escape(\$path) + '*'; Get-CimInstance Win32_Process -Filter \"Name = 'ow-electron.exe' OR Name = 'electron.exe'\" | Where-Object { \$_.CommandLine -and \$_.CommandLine -like \$pattern } | ForEach-Object { Write-Host \"[launch-electron] killed orphan PID \$(\$_.ProcessId) (\$(\$_.Name))\"; Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>/dev/null
}

# ow-electron package guard.
# Overwolf's package manifest API intermittently ships a ~21 KB GEP stub (see
# scripts/ow-package-guard.ts for the full story). ow-electron then loads a
# non-functional GEP, in-game augment events stop firing, and augment coaching
# silently dies while item/voice keep working. OWEPM re-downloads the stub over
# a known-good cache on every launch the override is not active, so the guard
# serves a corrected manifest on localhost (--owepm-packages-url) on every
# launch a real build is resolvable, standing down only when none is found.
OWEPM_OVERRIDE_PORT="${OWEPM_OVERRIDE_PORT:-17865}"
OWEPM_FLAG=""
GUARD_PID=""
# The in-app "Restart now" button exits with this code to ask for a relaunch.
RELAUNCH_EXIT_CODE=42

cleanup_guard() {
  if [ -n "${GUARD_PID}" ]; then
    kill "${GUARD_PID}" 2>/dev/null
    pkill -f "scripts/ow-package-guard.ts --serve" 2>/dev/null
    GUARD_PID=""
  fi
}
trap cleanup_guard EXIT

# Resolve the floor-clearing GEP and serve the localhost override manifest,
# setting OWEPM_FLAG for the launch. OWEPM_OVERRIDE_DISABLE=1 skips it so OWEPM
# resolves natively (the guard-off live test; see
# docs/research/gep-version-drift-recommendation.md). `pnpm ow-guard
# --healthcheck` prints the pre-game prediction.
start_guard() {
  OWEPM_FLAG=""
  if [ "${OWEPM_OVERRIDE_DISABLE}" = "1" ]; then
    echo "[launch-electron] OWEPM_OVERRIDE_DISABLE=1: skipping the GEP override guard; OWEPM resolves natively (guard-off live test). Run 'pnpm ow-guard --healthcheck' for the pre-game prediction."
    return
  fi
  ( cd "${PROJECT_ROOT}" && pnpm exec tsx scripts/ow-package-guard.ts --check )
  if [ $? -eq 3 ]; then
    echo "[launch-electron] latest live GEP build is resolvable; serving local override manifest on port ${OWEPM_OVERRIDE_PORT}"
    ( cd "${PROJECT_ROOT}" && pnpm exec tsx scripts/ow-package-guard.ts --serve --port "${OWEPM_OVERRIDE_PORT}" ) &
    GUARD_PID=$!
    echo "[launch-electron] Waiting for override manifest server..."
    tries=0
    until curl -s "http://localhost:${OWEPM_OVERRIDE_PORT}/packages" > /dev/null; do
      tries=$((tries + 1))
      if [ "${tries}" -ge 50 ]; then
        echo "[launch-electron] WARNING: override server did not start; launching without override"
        break
      fi
      sleep 0.2
    done
    if [ "${tries}" -lt 50 ]; then
      OWEPM_FLAG="'--owepm-packages-url=http://localhost:${OWEPM_OVERRIDE_PORT}/packages'"
    fi
  fi
}

# Launch loop. The in-app "Restart now" calls app.exit(RELAUNCH_EXIT_CODE); the
# loop then re-runs the guard (re-resolving the floor-clearing GEP) and restarts
# ow-electron in place. The launcher never exits on a relaunch, so the Vite dev
# server beside it under `concurrently -k` stays alive (a plain app.relaunch
# would exit the launcher and let concurrently kill Vite, leaving the relaunched
# app with no renderer). `exit $LASTEXITCODE` propagates ow-electron's code out
# of powershell.exe so the loop can read it.
while true; do
  sweep_orphans
  start_guard

  if [ "$1" = "--prod" ]; then
    echo "[launch-electron] Production mode: loading bundled HTML from dist/"
    powershell.exe -ExecutionPolicy Bypass -Command "${UTF8}; ow-electron ${OWEPM_FLAG} \"${PROJECT_WIN}\"; exit \$LASTEXITCODE"
    APP_EXIT=$?
  else
    echo "[launch-electron] Waiting for Vite dev server on localhost:1420..."
    while ! curl -s http://localhost:1420 > /dev/null 2>&1; do
      sleep 0.5
    done
    echo "[launch-electron] Vite is ready. Launching Electron..."
    powershell.exe -ExecutionPolicy Bypass -Command "${UTF8}; \$env:VITE_DEV_SERVER_URL='http://localhost:1420'; ow-electron ${OWEPM_FLAG} \"${PROJECT_WIN}\"; exit \$LASTEXITCODE"
    APP_EXIT=$?
  fi

  cleanup_guard
  echo "[launch-electron] ow-electron exited with code ${APP_EXIT}"

  if [ "${APP_EXIT}" = "${RELAUNCH_EXIT_CODE}" ]; then
    echo "[launch-electron] Restart requested; re-resolving GEP and relaunching..."
    # A forced test build (GEP_FORCE_VERSION) applies to the first launch only;
    # the relaunch resolves the real latest so the upgrade is observable.
    unset GEP_FORCE_VERSION
    continue
  fi
  break
done
