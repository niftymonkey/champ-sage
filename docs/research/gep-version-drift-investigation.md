# GEP version drift: why augments break almost every League patch

**Date:** 2026-06-27
**Author:** investigation handoff (Quinn-game augment outage)
**Status:** one concrete fix shipped on `fix/gep-guard-manifest-seed-discovery`; the structural question is open and is the reason this document exists.

## Why this document exists

Augment coaching goes dark on a recurring cadence, and each time the fix is "change something in the version guard." The latest instance: a Quinn ARAM Mayhem game on 2026-06-27 produced zero augment suggestions while item/gold coaching worked normally. This writeup captures the full mechanism, the concrete drift timeline, what was fixed this session, and the open question: **is there a way to ride Overwolf's GEP that does not require a code change on every Riot patch?**

The short version: we sit two hops downstream of Riot's patch cadence (Riot patches League, Overwolf bumps GEP to match and raises its minimum-version floor, we resolve and load GEP through OWEPM). Every link in that chain can break independently, and most of them have, at least once, in the last month.

## The moving parts

- **League client.** Patches roughly every two weeks. Current data version observed: `v16.13.1`.
- **GEP (Overwolf Game Events Provider).** The Overwolf native package that attaches to the running League process and emits in-game events. It is the ONLY source of augment offer/pick events. Everything else our app coaches on (enemy list, your items, gold, item recs) rides Live Client Data / LCU polling and keeps working when GEP dies, which is exactly why a GEP failure is silent: three of four coaching surfaces look healthy.
- **GEP minimum-version floor.** League raises the minimum GEP version it will accept on roughly every patch. A GEP build below the floor loads fine but is rejected at game-attach: its in-game handler never starts, so `game-detected` never reaches our app, so `setRequiredFeatures(["augments"])` never runs, so no augment events.
- **OWEPM (Overwolf Electron Package Manager).** ow-electron's runtime package manager. Fetches a version manifest from `https://electronapi.overwolf.com/packages`, then pulls each package binary from the CDN at `https://electrondl.overwolf.com/<channel>/<version>/module.owepk`. Channels: `gep=1`, `utility=2`, `overlay=3`.
- **Our guard** (`scripts/ow-package-guard.ts`). A workaround that serves a corrected manifest on localhost and hands it to ow-electron via the supported `--owepm-packages-url` flag, forcing OWEPM onto a known-good GEP build.

## The four failure modes seen so far

All four kill augment coaching while LCU coaching keeps working. They stack: a single launch can be hit by more than one.

1. **Manifest 0.0.0 outage** (since ~2026-05-29). The manifest API regresses and reports `version: "0.0.0"` for every package. OWEPM downloads a ~21 KB non-functional stub instead of the real ~19 MB GEP.
2. **Version floor.** A real, cached GEP that worked last patch is now below League's raised floor and is rejected at attach. GEP's own log (`%APPDATA%/ow-electron/<appHash>/logs/gep/gep.log`) prints `Detected GEP Version X is lower than the minimum allowed version: Y` then `game status is disabled, not starting handler for game`.
3. **Recovered-manifest stub** (2026-06-13). The manifest stops reporting `0.0.0` and reports a real version, but OWEPM still holds the ~21 KB stub on disk from the outage window. The version string reads healthy while the binary is a stub. Detect by file size, not version: a `.owepk` under ~1 MB is a stub.
4. **Discovery-window blind spot** (2026-06-27, this session). After the manifest recovered, our guard's served GEP froze at the newest build _bare CDN discovery could reach_ while League advanced past it. Detail below; this is the one we just fixed.

## The drift timeline (from `.ow-guard.log` at repo root)

The guard logs its verdict on every launch. Reading the log end to end tells the whole story. "newest real build" = what the guard discovered as latest; "served" = what it actually pinned.

| Date   | Newest real build (discovered) | Actually served | Notes                                                                               |
| ------ | ------------------------------ | --------------- | ----------------------------------------------------------------------------------- |
| Jun 6  | n/a (0.0.0 outage)             | 306.0.3         | purged 305.1.3 -> 306.0.3                                                           |
| Jun 8  | n/a (0.0.0 outage)             | 306.0.4         | purged 306.0.3 -> 306.0.4                                                           |
| Jun 13 | 306.0.10                       | 306.0.10        | manifest recovered; purged stub 306.0.4 -> 306.0.10. **Last date augments worked.** |
| Jun 15 | 307.1.1                        | 306.0.10        | drift begins                                                                        |
| Jun 19 | 307.2.2                        | 306.0.10        | real 306.0.10 .owepk re-downloaded (18.8 MB, on disk)                               |
| Jun 22 | 307.2.2                        | 306.0.10        |                                                                                     |
| Jun 25 | 307.4.4                        | 306.0.10        | augments dead (game log `champ-sage-2026-06-25`)                                    |
| Jun 27 | 307.4.6                        | 306.0.10        | augments dead (Quinn game `champ-sage-2026-06-27`)                                  |

Between Jun 13 and Jun 27, League advanced its bundled GEP `306.0.10 -> 307.1.1 -> 307.2.2 -> 307.4.4 -> 307.4.6` while we stayed pinned at `306.0.10`. Once `306.0.10` dropped below the floor, augments stopped, silently.

## The bug behind the 2026-06-27 instance

The guard had two version-resolution paths that had silently diverged:

- `--check` (`resolveLatestServedGep`) read the now-recovered Overwolf manifest and correctly reported the true latest: `307.4.6`. That is the version printed in `.ow-guard.log`.
- `--serve` (`buildOverrideManifest` -> `discoverLatestVersion`) ignored the manifest and walked the CDN upward from a hardcoded baseline `{306,0,0}`, and **structurally could not reach `307.4.x`**.

Why discovery cannot reach it: `discoverLatestVersion` scans the baseline line plus `minorLookahead=2, majorLookahead=1`, so from `306.0.0` it only probes the `306.0.x`, `306.1.x`, `306.2.x`, and `307.0.x` lines. Live-CDN probe today:

```
306.0.10 -> 206 (real)
307.0.0  -> 403 (entire 307.0.x line is rotated off / never shipped)
307.1.1  -> 206 (real)
307.2.2  -> 206 (real)
307.4.4  -> 206 (real)
307.4.6  -> 206 (real, current latest)
307.5.0  -> 403 (unreleased)
```

Overwolf skipped the `307.0.x` line entirely. Discovery probes `307.0.x`, finds nothing (all 403), and never tries `307.1+`. It falls back to the newest it can see, `306.0.10`. So `--check` bragged about `307.4.6` while `--serve` pinned `306.0.10`, the cache already matched `306.0.10`, nothing was purged, and the stale build kept loading.

## What was fixed this session

Unified both paths onto one helper, `resolveGepVersion(baseline, probe, manifest)`:

- Prefer the version the recovered manifest advertises, but only when a CDN probe confirms that exact build is downloadable.
- Fall back to baseline CDN discovery only during the `0.0.0` outage, when the manifest is unreachable, or when the advertised build is not yet on the CDN.
- `--check` and `--serve` now call the same helper, so reported version == served version, always.

Effect: the guard now resolves `307.4.6` from the recovered manifest (verified live), the next `pnpm dev:electron` purges `306.0.10` and pulls `307.4.6`, and augments return. Crucially, the guard now **self-tracks the manifest's advertised latest**, so this specific drift should not recur each patch as long as the manifest stays healthy.

Files: `scripts/ow-package-guard.ts`, `scripts/ow-package-guard.test.ts`, `docs/reference/technical-reference.md`.

## Why this keeps happening (the structural root)

The recurring force is **the version floor plus CDN rotation plus the lack of a stable "latest" pointer**, compounded by an **unreliable manifest**:

1. The floor rises ~every League patch, so any fixed pin or frozen cache eventually falls below it. This alone guarantees periodic breakage of any static approach.
2. Overwolf rotates old builds off the CDN (older versions 403), so "pin one known-good version forever" is not available; the pin goes dead.
3. There is no version listing and no `latest` alias on the CDN. Resolution must _guess_ by probing, and the guess is fragile when version lines are non-contiguous (the `307.0.x` gap is exactly this).
4. The manifest, which _is_ the natural "latest" pointer, spent ~2 weeks serving `0.0.0` and still intermittently lags or holds stubs. So the one authoritative source has not been trustable.
5. OWEPM re-resolves every launch and will re-stub a known-good cache, which is why the guard overrides on _every_ launch rather than only when stale.

In other words: we are riding a fast-moving native dependency that has no stable channel pointer we can trust, while the platform's own pointer has been flaky. Every patch moves the target; nothing in the current design pins us to a _moving_ target automatically and reliably.

## Open questions and directions for a more graceful approach

These are hypotheses to investigate, not decisions. Ordered roughly by likely payoff.

1. **Is the guard still needed at all?** The whole guard exists because the manifest served `0.0.0`. The manifest has been healthy since ~Jun 13. Test: launch with the guard fully disabled for a few days and watch `gep.log`. If OWEPM's normal resolution now serves the real latest reliably, the guard can be retired or reduced to a healthcheck. The override-every-launch behavior was a response to a specific outage that may be over.

2. **Reactive guard instead of proactive.** Today the guard overrides on every launch, pre-emptively. Alternative: let OWEPM resolve normally, detect failure (stub on disk by size, or parse `gep.log` for the `minimum allowed version` rejection), and only then override and relaunch. This stops fighting OWEPM when it is healthy and only intervenes on a real, observed failure. Downside: a failed first launch before the relaunch.

3. **Read the actual floor instead of guessing latest.** GEP's log prints the exact `minimum allowed version: Y` it wants. If that number (or an Overwolf API exposing it per League build) can be read pre-launch, we could resolve the lowest build that _clears the floor_ rather than chasing "newest", which is more stable and avoids overshooting into builds the platform has not validated.

4. **Trust the manifest as the latest pointer (now done) and lean into it.** The fix already does this. The follow-on question: can `package.json`'s `overwolf.packages` declaration plus OWEPM's normal manifest resolution be configured to always take the manifest's latest, making our localhost override redundant? Compare our setup against the current `overwolf/ow-electron-packages-sample` to see if they changed the recommended resolution since we forked our approach.

5. **Self-updating discovery floor.** Persist the last-known-good GEP version to disk and seed discovery's baseline from it, so even during a future `0.0.0` outage the fallback floor follows automatically. This closes the documented residual: if the manifest regresses to `0.0.0` again while League's floor sits above the discoverable `306.x` range, today's baseline `{306,0,0}` is too low and would need a manual bump.

6. **Upstream the platform question to Overwolf.** The deepest fix is not ours: ask Overwolf whether there is a stable production channel / `latest` alias for GEP, why the manifest served `0.0.0` for two weeks, and what the supported way to always load the floor-clearing build is. We are whitelisted (see `docs/Overwolf - Congrats! You've been whitelisted.pdf`); there may be a support channel. If Overwolf offers a supported "always latest production" mechanism, the entire guard becomes unnecessary.

7. **Pre-game healthcheck with a visible warning.** Independent of how resolution works, add a launch-time check that verifies GEP actually _attaches_ (not just that a version resolved) and surfaces a clear warning to the user before they queue, instead of discovering mid-game that augments are silent. This turns a silent failure into a loud one, which is the single highest-leverage change for the user experience regardless of the resolution strategy.

## How to diagnose the next instance fast

1. Latest game log: `/mnt/c/Users/<user>/AppData/Roaming/champ-sage/logs/champ-sage-*.log` (newest mtime). Grep for `Required features set` and `League detected`. Their absence with an `Overwolf package ready: gep vX` line present means GEP loaded but never attached (floor or stub).
2. Guard verdict: `.ow-guard.log` at repo root. Compare "newest real build" vs the `gep@X` it actually served on the last launch. Divergence is the smell.
3. Cached binary: `/mnt/c/Users/<user>/AppData/Roaming/ow-electron/<appHash>/packages/<GEP_UID>.owepk` (GEP_UID `hhideknibngookbhmhalphpipjeogcfefhobblkk`). ~21 KB = stub, ~19 MB = real.
4. CDN truth: ranged GET each candidate version, `curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-0" https://electrondl.overwolf.com/1/<ver>/module.owepk`. 206 = live, 403 = rotated/unreleased.
5. GEP runtime log: `%APPDATA%/ow-electron/<appHash>/logs/gep/gep.log` prints the floor rejection (`minimum allowed version: Y`) and the live `"featureName":"augments"` updates when working.

## Cross-references

- `docs/reference/technical-reference.md`, section "GEP package resolution: the 0.0.0 outage and the version floor" (the canonical reference; now lists all four failure modes).
- `scripts/ow-package-guard.ts` and its test for the resolution logic.
- `electron/main.ts` `initGep()` for the attach flow (`game-detected` -> `setRequiredFeatures` -> `new-info-update`).
- `src/lib/reactive/gep-bridge.ts` for the renderer-side augment-offer stream.
