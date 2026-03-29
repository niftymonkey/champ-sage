#!/bin/bash
# Launch Electron from WSL2 via the Windows-side electron binary.
#
# Prerequisites: install electron globally on Windows:
#   npm install -g electron
#
# Vite dev server runs in WSL2 on localhost:1420, shared with Windows.
# The electron CLI accepts a project path as its first argument.

PROJECT_WIN='\\wsl.localhost\Ubuntu\home\mlo\dev\niftymonkey\champ-sage'

# Wait for Vite dev server to be ready
echo "[launch-electron] Waiting for Vite dev server on localhost:1420..."
while ! curl -s http://localhost:1420 > /dev/null 2>&1; do
  sleep 0.5
done
echo "[launch-electron] Vite is ready. Launching Electron..."

powershell.exe -ExecutionPolicy Bypass -Command "\$env:VITE_DEV_SERVER_URL='http://localhost:1420'; electron '${PROJECT_WIN}'"
