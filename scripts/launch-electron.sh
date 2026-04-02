#!/bin/bash
# Launch Electron from WSL2 via the Windows-side ow-electron binary.
#
# Prerequisites: install ow-electron globally on Windows:
#   npm install -g @overwolf/ow-electron
#
# Derives the Windows path from the repo root automatically via wslpath,
# so this works regardless of where the repo is cloned.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PROJECT_WIN="$(wslpath -w "${PROJECT_ROOT}")"

# Wait for Vite dev server to be ready
echo "[launch-electron] Waiting for Vite dev server on localhost:1420..."
while ! curl -s http://localhost:1420 > /dev/null 2>&1; do
  sleep 0.5
done
echo "[launch-electron] Vite is ready. Launching Electron..."

# Change to a Windows-compatible directory before running powershell.exe to avoid UNC path warnings
# and use double quotes for the PowerShell command to handle paths correctly.
cd /mnt/c
powershell.exe -ExecutionPolicy Bypass -Command "\$env:VITE_DEV_SERVER_URL='http://localhost:1420'; ow-electron \"${PROJECT_WIN}\""
