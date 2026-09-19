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
# wslpath fails outside WSL and on paths Windows cannot see. Unchecked, the
# empty result launches ow-electron against "" and it loads the wrong app.
if ! PROJECT_WIN="$(wslpath -w "${PROJECT_ROOT}")" || [ -z "${PROJECT_WIN}" ]; then
  echo "[launch-electron] Error: wslpath could not map ${PROJECT_ROOT} to a Windows path; this launcher has to run inside WSL." >&2
  exit 1
fi

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

# Comma-separated tokens telling the app how its own launch went, read by
# parseLaunchStatus() in src/lib/app-status.ts. Without this the launcher's
# degrades were terminal-only: the warnings scrolled past in a terminal the
# player is not looking at, and the app came up with no idea it had been
# launched with its package checks skipped.
#
# `runtime-repaired` is reserved and has no producer: the preflight exits 0
# whether it repaired anything or not, so the launcher cannot tell, and a
# completed repair raises no banner anyway.
LAUNCH_STATUS=""
add_launch_status() {
  if [ -z "${LAUNCH_STATUS}" ]; then
    LAUNCH_STATUS="$1"
  else
    LAUNCH_STATUS="${LAUNCH_STATUS},$1"
  fi
}
# The in-app "Restart now" button exits with this code to ask for a relaunch.
RELAUNCH_EXIT_CODE=42

# The guard is invoked by ABSOLUTE path so its command line carries this
# checkout's root, and the sweep pattern can be scoped to it. The old pattern
# matched "scripts/ow-package-guard.ts --serve" anywhere, so starting a second
# checkout killed the first one's guard and left it launching unguarded.
# Regex metacharacters in the path are escaped, since pkill -f takes a pattern.
GUARD_SCRIPT="${PROJECT_ROOT}/scripts/ow-package-guard.ts"
GUARD_PATTERN="$(printf '%s' "${GUARD_SCRIPT} --serve" | sed 's/[][\.*^$(){}?+|]/\\&/g')"

cleanup_guard() {
  if [ -n "${GUARD_PID}" ]; then
    kill "${GUARD_PID}" 2>/dev/null
    # `kill` reaps the subshell; the tsx process under it survives, which is
    # what this catches.
    pkill -f "${GUARD_PATTERN}" 2>/dev/null
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
  # Exit codes say which of three different things happened, so the app can be
  # told which one: 3 = serve the override; 1 = no live build resolvable, a
  # known degrade; 4 (or anything else) = the guard itself broke. Every one of
  # them launches. Which token the app gets is the only difference.
  ( cd "${PROJECT_ROOT}" && pnpm exec tsx "${GUARD_SCRIPT}" --check )
  guard_status=$?
  case "${guard_status}" in
    3)
      echo "[launch-electron] latest live GEP build is resolvable; serving local override manifest on port ${OWEPM_OVERRIDE_PORT}"
      ( cd "${PROJECT_ROOT}" && pnpm exec tsx "${GUARD_SCRIPT}" --serve --port "${OWEPM_OVERRIDE_PORT}" ) &
      GUARD_PID=$!
      echo "[launch-electron] Waiting for override manifest server..."
      tries=0
      guard_ready=0
      guard_exited=0
      while true; do
        # -f rejects non-2xx (a stray process answering 4xx/5xx on the port must
        # not count as ready); --max-time 1 bounds each poll; 127.0.0.1 drops the
        # localhost DNS/IPv6 ambiguity (the guard binds 127.0.0.1).
        if curl -fs --max-time 1 "http://127.0.0.1:${OWEPM_OVERRIDE_PORT}/packages" > /dev/null; then
          guard_ready=1
          break
        fi
        # A guard that already gave up (a taken port exits 5) is never going to
        # answer, and polling a dead process for the full 10s is time the player
        # spends looking at nothing.
        if ! kill -0 "${GUARD_PID}" 2>/dev/null; then
          guard_exited=1
          break
        fi
        tries=$((tries + 1))
        if [ "${tries}" -ge 50 ]; then
          break
        fi
        sleep 0.2
      done
      if [ "${guard_ready}" -eq 1 ]; then
        OWEPM_FLAG="'--owepm-packages-url=http://127.0.0.1:${OWEPM_OVERRIDE_PORT}/packages'"
      elif [ "${guard_exited}" -eq 1 ]; then
        # It stopped rather than ran out of time, so the app is told the guard
        # broke, not that it was slow.
        echo "[launch-electron] WARNING: the override server exited before it was ready (see .ow-guard.log); launching WITHOUT override. The in-app banner will flag it." >&2
        add_launch_status "guard-crash"
      else
        echo "[launch-electron] WARNING: override server did not become ready in time; launching WITHOUT override. Augment coaching may be unavailable; the in-app banner will flag it." >&2
        add_launch_status "override-timeout"
      fi
      ;;
    1)
      echo "[launch-electron] WARNING: no live GEP build resolvable (guard --check exit 1); launching WITHOUT override. Augment coaching may be unavailable; the in-app banner will flag it." >&2
      add_launch_status "unguarded"
      ;;
    *)
      # This arm used to abort the launch. It was aiming at a guard crash and
      # hitting the wrong case: a crash exits 1 (read above as the benign
      # degrade) while missing tooling exits 127 and landed here. The guard now
      # exits 4 when it crashes, but the answer either way is the same: the
      # launcher must never refuse to launch the app because its own helper
      # broke. Launch unguarded and let the app say so.
      echo "[launch-electron] WARNING: ow-package-guard --check exited ${guard_status}; the guard itself failed. Launching WITHOUT override; the in-app banner will flag it." >&2
      add_launch_status "guard-crash"
      ;;
  esac
}

# ow-electron's Windows global install carries no Electron runtime until its
# postinstall extracts one into dist/, and that tree can go missing (observed
# 2026-08-17; a pnpm global upgrade with ignoredBuilds active can also skip
# install.js and leave the same state). Without this check the launch dies on
# "Electron failed to install correctly" before any window exists. The
# preflight repairs in place when it can, and refuses the launch only when the
# runtime is genuinely unusable; if the preflight itself breaks, launch anyway
# rather than let a broken helper stop the app.
ensure_ow_electron_runtime() {
  ( cd "${PROJECT_ROOT}" && pnpm exec tsx scripts/ow-runtime-preflight.ts )
  preflight_status=$?
  # The preflight prints its own verdict, including what it repaired, so this
  # only has to decide whether launching is still on.
  case "${preflight_status}" in
    0) ;;
    3)
      echo "[launch-electron] ERROR: the Windows ow-electron runtime is unusable (see above). Not launching." >&2
      exit 3
      ;;
    *)
      echo "[launch-electron] WARNING: runtime preflight exited ${preflight_status} (it could not decide); launching anyway." >&2
      ;;
  esac
}

# Dev-only fault injection so the loop below can actually be exercised: makes
# the app exit with a chosen code after a chosen delay (see electron/main.ts).
# Digits only, since the value is interpolated into a PowerShell command line.
sim_env_prefix() {
  local prefix=""
  case "${CS_SIMULATE_EXIT}" in
    "") ;;
    *[!0-9]*) echo "[launch-electron] WARNING: ignoring non-numeric CS_SIMULATE_EXIT" >&2 ;;
    *) prefix="\$env:CS_SIMULATE_EXIT='${CS_SIMULATE_EXIT}'; " ;;
  esac
  case "${CS_SIMULATE_EXIT_DELAY_MS}" in
    "") ;;
    *[!0-9]*) echo "[launch-electron] WARNING: ignoring non-numeric CS_SIMULATE_EXIT_DELAY_MS" >&2 ;;
    *) prefix="${prefix}\$env:CS_SIMULATE_EXIT_DELAY_MS='${CS_SIMULATE_EXIT_DELAY_MS}'; " ;;
  esac
  # A boot-step name (see boot() in electron/main.ts). Restricted to the
  # characters real step names use, since the value lands inside a
  # single-quoted PowerShell string.
  case "${CS_SIMULATE_BOOT_ERROR}" in
    "") ;;
    *[!a-z0-9-]*) echo "[launch-electron] WARNING: ignoring CS_SIMULATE_BOOT_ERROR (expected a step name like 'decision-log')" >&2 ;;
    *) prefix="${prefix}\$env:CS_SIMULATE_BOOT_ERROR='${CS_SIMULATE_BOOT_ERROR}'; " ;;
  esac
  printf '%s' "${prefix}"
}

# Kept separate from sim_env_prefix, and built inside the launch loop, because
# LAUNCH_STATUS is not known until start_guard has run. Building it with the
# simulation prefix (which is computed once, before the loop) would have shipped
# an env var that was always empty.
launch_status_prefix() {
  # Restricted to the token alphabet since the value lands inside a
  # single-quoted PowerShell string; the app drops anything it does not
  # recognise anyway.
  case "${LAUNCH_STATUS}" in
    "") ;;
    *[!a-z,-]*) echo "[launch-electron] WARNING: ignoring malformed LAUNCH_STATUS '${LAUNCH_STATUS}'" >&2 ;;
    *) printf '%s' "\$env:CHAMP_SAGE_LAUNCH_STATUS='${LAUNCH_STATUS}'; " ;;
  esac
}

ensure_ow_electron_runtime
SIM_ENV="$(sim_env_prefix)"

# How long the dev launch waits for Vite before giving up and launching anyway.
VITE_WAIT_SECONDS=90

# Loop bounds. A relaunch that dies before the app is ever usable would spin
# forever without a cap, while a crash after a long healthy session is worth
# exactly one silent retry.
FAST_EXIT_SECONDS=10
MAX_FAST_RELAUNCHES=3
MIN_UPTIME_FOR_AUTO_RELAUNCH=60
EXIT_RELAUNCH_LOOP=70
fast_relaunches=0
auto_relaunched=0

# Launch loop. The in-app "Restart now" calls app.exit(RELAUNCH_EXIT_CODE); the
# loop then re-runs the guard (re-resolving the floor-clearing GEP) and restarts
# ow-electron in place. The launcher never exits on a relaunch, so the Vite dev
# server beside it under `concurrently -k` stays alive (a plain app.relaunch
# would exit the launcher and let concurrently kill Vite, leaving the relaunched
# app with no renderer). `exit $LASTEXITCODE` propagates ow-electron's code out
# of powershell.exe so the loop can read it.
while true; do
  sweep_orphans
  # Reset per iteration: a relaunch can guard cleanly after a launch that did
  # not, and a stale token would keep the banner up for a fixed problem.
  LAUNCH_STATUS=""
  start_guard
  LAUNCH_ENV="$(launch_status_prefix)"

  if [ "$1" = "--prod" ]; then
    echo "[launch-electron] Production mode: loading bundled HTML from dist/"
    # Timed from here, not from the top of the loop: the orphan sweep, the
    # guard, and the Vite wait are not app uptime, and counting them would let
    # an app that dies instantly look like it stayed up.
    launch_started=${SECONDS}
    powershell.exe -ExecutionPolicy Bypass -Command "${UTF8}; ${LAUNCH_ENV}ow-electron ${OWEPM_FLAG} \"${PROJECT_WIN}\"; exit \$LASTEXITCODE"
    APP_EXIT=$?
  else
    echo "[launch-electron] Waiting for Vite dev server on localhost:1420..."
    vite_wait_started=${SECONDS}
    # -f so a non-2xx answer does not count as ready, and --max-time 1 so a
    # hung socket does not stall a poll. The wait is capped because a launcher
    # that waits forever is a launcher with no window: recovery from a late or
    # dead Vite belongs to the app's own renderer retry loop, which needs a
    # window to run in. Bounded on the clock rather than on a poll count, since
    # each poll takes anywhere from milliseconds to 1.5s.
    until curl -fs --max-time 1 http://localhost:1420 > /dev/null 2>&1; do
      if [ $((SECONDS - vite_wait_started)) -ge "${VITE_WAIT_SECONDS}" ]; then
        echo "[launch-electron] WARNING: Vite did not answer on localhost:1420 within ${VITE_WAIT_SECONDS}s; launching anyway so there is a window. It retries the renderer load on its own." >&2
        break
      fi
      sleep 0.5
    done
    echo "[launch-electron] Launching Electron..."
    launch_started=${SECONDS}
    powershell.exe -ExecutionPolicy Bypass -Command "${UTF8}; ${SIM_ENV}${LAUNCH_ENV}\$env:VITE_DEV_SERVER_URL='http://localhost:1420'; ow-electron ${OWEPM_FLAG} \"${PROJECT_WIN}\"; exit \$LASTEXITCODE"
    APP_EXIT=$?
  fi

  app_uptime=$((SECONDS - launch_started))
  cleanup_guard
  echo "[launch-electron] ow-electron exited with code ${APP_EXIT} after ${app_uptime}s"

  if [ "${APP_EXIT}" = "${RELAUNCH_EXIT_CODE}" ]; then
    if [ "${app_uptime}" -lt "${FAST_EXIT_SECONDS}" ]; then
      fast_relaunches=$((fast_relaunches + 1))
      if [ "${fast_relaunches}" -ge "${MAX_FAST_RELAUNCHES}" ]; then
        echo "[launch-electron] ERROR: ${fast_relaunches} restart requests in under ${FAST_EXIT_SECONDS}s each; the app is not staying up. Stopping." >&2
        APP_EXIT="${EXIT_RELAUNCH_LOOP}"
        break
      fi
    else
      fast_relaunches=0
    fi
    echo "[launch-electron] Restart requested; re-resolving GEP and relaunching..."
    # A forced test build (GEP_FORCE_VERSION) applies to the first launch only;
    # the relaunch resolves the real latest so the upgrade is observable.
    unset GEP_FORCE_VERSION
    continue
  fi

  # A crash after a long healthy session buys one silent relaunch, so a
  # mid-session fault costs a reload rather than the app. A second crash is not
  # a fluke, so it exits and says so.
  if [ "${APP_EXIT}" -ne 0 ] && [ "${app_uptime}" -ge "${MIN_UPTIME_FOR_AUTO_RELAUNCH}" ] && [ "${auto_relaunched}" -eq 0 ]; then
    auto_relaunched=1
    echo "[launch-electron] Crashed after ${app_uptime}s of uptime; relaunching once."
    continue
  fi
  break
done

# The loop used to fall out here and let the script exit 0, which laundered an
# ow-electron crash into a clean-looking shutdown.
exit "${APP_EXIT}"
