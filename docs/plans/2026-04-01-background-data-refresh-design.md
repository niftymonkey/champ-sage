# Background Data Refresh on Launch

**Issue:** #75  
**Date:** 2026-04-01

## Problem

The app fetches game data from free community resources (Data Dragon, League Wiki, Community Dragon). If the app scales to many concurrent users, every client fetching on every launch would overwhelm these sources — especially on patch day when thousands of clients launch simultaneously.

## Design

### Cache-first with smart version check

On launch, the app serves data instantly from localStorage cache. In the background, it checks whether a new patch version exists. Only when the version has changed does it fetch fresh data — with a random jitter delay to spread load across time.

### Data Ingest Layer (`src/lib/data-ingest/index.ts`)

**New functions:**

- `loadCachedGameData(): Promise<LoadedGameData | null>` — reads from cache only, returns null on miss. This is the "instant serve" path.
- `checkForNewVersion(cachedVersion: string): Promise<boolean>` — calls `fetchLatestVersion()` and compares against the cached version. Returns `true` if they differ, or if the check fails (treat errors as "might be new" so we don't block refresh on transient failures).

**Modified:**

- `CachedGameData` gains a `lastRefreshedAt: number` field (epoch ms timestamp), written by `fetchAndCache()`.
- `fetchAndCache()` stays as-is but writes `lastRefreshedAt: Date.now()` into the cached data.
- `loadGameData()` behavior unchanged (still the entry point for dev mode and cold-cache fallback).

### Hook Orchestration (`src/hooks/useGameData.ts`)

The hook drives the two-phase load:

**Warm cache (production, common case):**

1. `loadCachedGameData()` → cache hit → `setData(cached)` immediately (no loading spinner)
2. `checkForNewVersion(cached.version)` → push "checking for updates" notification
3. Version matches → push "data is current" notification (silent/logged only), done
4. Version differs → random jitter delay (0–300 seconds), then `fetchAndCache()`, push "updating" notification
5. Success → `setData(newData)`, push "updated to patch X.Y" notification
6. Failure → push error notification, keep serving cached data

**Cold cache (first launch):**

1. `loadCachedGameData()` returns null
2. Show loading state, call `fetchAndCache()` directly (no jitter — nothing to serve yet)
3. `setData(result)`

**Dev mode:**

- Unchanged: skip cache, call `fetchAndCache()` directly, no version check, no jitter.

**Manual refresh button:**

- Runs `checkForNewVersion()` first (no jitter). If current, pushes "already up to date" notification without fetching. If stale, calls `fetchAndCache()` and updates data.

### Jitter

When a version mismatch is detected during the automatic launch check, the background fetch is delayed by a random duration between 0 and 300 seconds. This spreads load across ~5 minutes when many clients detect a new patch simultaneously.

Jitter applies only to the automatic launch refresh, not to manual refresh.

### Notifications

Refresh status flows through the existing `notifications$` stream (`AppNotification` in `src/lib/reactive/types.ts`). No new RxJS subjects.

Notification messages:

- `{ level: "info", message: "Checking for updates..." }`
- `{ level: "info", message: "Updating to patch X.Y..." }`
- `{ level: "success", message: "Updated to patch X.Y" }`
- `{ level: "info", message: "Data is current" }` (logged only, no UI)
- `{ level: "error", message: "Update check failed — using cached data" }`

**Note:** `AppNotification.level` needs `"success"` added to its union type.

### Hook Internal State

The hook tracks refresh phase with local React state (not an observable) to drive button text:

- `refreshState: "idle" | "checking" | "refreshing"`
- Button text: "Refresh" / "Checking..." / "Updating..."
- Button disabled during checking/refreshing

### UI Changes (`src/App.tsx`)

The existing refresh button adapts:

- During version check: disabled, text "Checking..."
- During background fetch: disabled, text "Updating..."
- After update: version string updates in place (already happens via `data.version` re-render)
- Notifications surface through whatever notification UI exists or is built later

### Data Flow to LLM Context

When `setData(newData)` is called after a background refresh, React re-renders `App` with the new `data` reference. All downstream consumers update automatically:

- `effectiveState` useMemo recomputes (has `data` in deps)
- `DataBrowser` receives new `data` prop
- `assembleContext()` is called with the current `data` at request time

Any coaching request made after the refresh completes uses the fresh data. An in-flight request uses the data it was assembled with, which is acceptable.

## Testing

### `src/lib/data-ingest/index.test.ts` (extend)

- `loadCachedGameData()` returns data when cache hit
- `loadCachedGameData()` returns null when cache miss
- `checkForNewVersion()` returns false when versions match
- `checkForNewVersion()` returns true when versions differ
- `checkForNewVersion()` returns true when fetch fails (safe fallback)
- `lastRefreshedAt` is written by `fetchAndCache()`

### `src/hooks/useGameData.test.ts` (new)

Mock `loadCachedGameData`, `checkForNewVersion`, `fetchAndCache` at the module boundary.

- Warm cache: sets data immediately, then kicks off version check
- Cold cache: shows loading state, fetches, sets data
- Version match: no fetch triggered after check
- Version mismatch: `fetchAndCache()` called after jitter
- Manual refresh with current version: no fetch, "already up to date" notification
- Manual refresh with stale version: fetches and updates data
- Background fetch failure: cached data preserved, error notification pushed
- Jitter is within 0–300s bounds (test range, not exact value)

## Files Changed

**Modified:**

- `src/lib/data-ingest/index.ts` — add `loadCachedGameData()`, `checkForNewVersion()`, `lastRefreshedAt`
- `src/lib/data-ingest/cache.ts` — update comment (still references Tauri)
- `src/lib/reactive/types.ts` — add `"success"` to `AppNotification.level`
- `src/hooks/useGameData.ts` — two-phase load, version check, jitter, notifications
- `src/App.tsx` — refresh button reflects richer status states
- `src/lib/data-ingest/index.test.ts` — tests for new functions

**Added:**

- `src/hooks/useGameData.test.ts`

No new dependencies. No new RxJS streams.
