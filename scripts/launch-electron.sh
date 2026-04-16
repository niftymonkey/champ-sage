#!/bin/bash
# Launch Electron from WSL2 via the Windows-side ow-electron binary.
#
# Prerequisites: install ow-electron globally on Windows:
#   npm install -g @overwolf/ow-electron
#
# Modes:
#   (default)  dev   — wait for Vite dev server, set VITE_DEV_SERVER_URL
#   --prod           — load bundled HTML files from dist/, no dev server
#
# Derives the Windows path from the repo root automatically via wslpath,
# so this works regardless of where the repo is cloned.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PROJECT_WIN="$(wslpath -w "${PROJECT_ROOT}")"

# Change to a Windows-compatible directory before running powershell.exe to avoid UNC path warnings
cd /mnt/c || { echo "[launch-electron] Error: Cannot change to /mnt/c"; exit 1; }

UTF8='[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'

if [ "$1" = "--prod" ]; then
  echo "[launch-electron] Production mode — loading bundled HTML from dist/"
  powershell.exe -ExecutionPolicy Bypass -Command "${UTF8}; ow-electron \"${PROJECT_WIN}\""
else
  echo "[launch-electron] Waiting for Vite dev server on localhost:1420..."
  while ! curl -s http://localhost:1420 > /dev/null 2>&1; do
    sleep 0.5
  done
  echo "[launch-electron] Vite is ready. Launching Electron..."
  powershell.exe -ExecutionPolicy Bypass -Command "${UTF8}; \$env:VITE_DEV_SERVER_URL='http://localhost:1420'; ow-electron \"${PROJECT_WIN}\""
fi
