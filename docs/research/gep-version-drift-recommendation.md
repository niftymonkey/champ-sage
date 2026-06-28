# GEP version drift: the long-term recommendation

**Date:** 2026-06-27
**Status:** recommendation, ready for decision. Extends `docs/research/gep-version-drift-investigation.md` (the mechanics) with an evaluated path.
**How this was produced:** a multi-agent research workflow (4 recon + adversarial verify + 4 competing designs + synthesis), with every load-bearing claim verified against live primary sources and re-probed by hand. See "Review packet" at the end.

## TL;DR

Stop treating this as a resolution problem to perfect and start treating it as a reliability bet to instrument. Three moves, in order:

1. **Ship a loud pre-queue GEP healthcheck now** (unconditional, observation-only, cannot regress the working override). It reads League's live version floor from a public Overwolf endpoint and turns today's silent augment death into a visible warning before the user queues. This is the single highest-leverage change and it is independent of every other decision.
2. **Send the upstream ask to Overwolf in parallel** (whitelisted-partner channel). The deepest fix is not ours to write: there is no supported client-side mechanism we are missing, so a durable fix depends on Overwolf blessing one.
3. **Run the guard-off live test across one patch, then decide retirement** on a pre-committed branch map. The override is temporary by design; this is the experiment that earns its removal.

The already-shipped manifest-seed fix (`resolveGepVersion`) has already broken the **common-case** treadmill: as of today the guard self-tracks the manifest's advertised latest with no hand-edit. What remains is the **outage-case** residual and the open question of whether the override is still needed at all. This plan closes the residual softly and answers the question empirically.

## What changed since the investigation doc (verified live 2026-06-27)

The single most important discovery: **Overwolf publishes League's exact GEP version floor on a public, no-auth HTTP endpoint, readable before a game is queued.**

- `https://game-events-status.overwolf.com/5426_prod.json` returns `min_gep_version_electron` (currently **307.4.2**), a top-level `state`, a per-feature `augments` block with its own `state`, and `disabled_electron`. This is a **separate Overwolf service** from the packages manifest that served `0.0.0` for two weeks, so it is usable as an independent floor signal.
- It is the same floor GEP enforces at attach. Cross-validated against our own drift timeline: cached `306.0.10` < `307.4.2` (rejected, matches the Quinn-game outage); served `307.4.6`/`307.4.7` >= `307.4.2` (clears). This is the queryable "read the floor" API the investigation's open-question #3 only hypothesized.
- Two floor fields exist: `min_gep_version` (native) and `min_gep_version_electron` (ow-electron). They can differ (Dota: 301.0.3 vs 301.0.4). **Use `_electron`.**

Other verified live facts today:

- Packages manifest is healthy and advertises `gep 307.4.7` (`lastUpdateUTC 2026-06-27T09:46Z`); `307.4.7` is the newest CDN-live build (`307.4.8`+/`307.5.x`/`308.x` are 403). So the shipped manifest-seed fix resolves `307.4.7`, which clears the floor.
- The manifest carries **no `url` field** per package (only `name`, `uid`, `version`, `phasing`). OWEPM derives the CDN URL by channel+version convention. So our localhost override works by **advertising a version**, not by pointing at a custom URL.
- A separate `vgep` package exists in the manifest (`307.0.0`, own uid), but League reports `is_vgep: false`. **vgep is not an escape hatch for us** today.
- All four guard pins are still CDN-live (utility 2.7.5/2.8.5, overlay 1.12.5/1.13.12 all 206), so the stale-pin divergence is latent, not broken.

## The platform reality (verified, not assumed)

- **There is no supported client-side version-control mechanism we are missing.** `package.json overwolf.packages` accepts bare names only (no pin/range/channel), confirmed against the sample, the README, and the installed `@overwolf/ow-electron` types. OWEPM's documented model is implicit always-latest (auto-update every few hours, install on restart, delete the prior version). [CONFIRMED]
- **"Ride Overwolf's supported latest" and "what the guard already does" collapse to the same endpoint.** The production manifest IS the de-facto latest pointer, and it is the exact thing that regressed to `0.0.0`. The override is redundant **only if that manifest is trustworthy**. The real variable is manifest reliability, not a config we lack. [CONFIRMED]
- **`--owepm-packages-url` is officially supported but documented as a DEV/QA switch** ("remove for PROD"). We point it at localhost, which is a supported flag used for an undocumented target with an undocumented payload shape. No stability contract. [CONFIRMED]
- **No GEP/OWEPM event reports the floor or the attach rejection.** The floor-reject is silent: `game-detected` never fires, so there is no rejected promise and no `error` event for it. Detection must be app-built. [CONFIRMED]
- **No GEP swap without an app relaunch.** OWEPM applies updates on restart; a reactive in-app fix cannot hot-swap GEP. [CONFIRMED]
- **A distribution gate is coming.** June 2026 Overwolf made exe code-signing mandatory for packages to load in distributed builds (gated to `@overwolf/ow-electron-builder 26.9.0`) and shipped an authenticated owepm "Dev Mode" (gated to `ow-electron 39.8.x`). Both are **beta-only** today; we are on stable 39.6.1 / 26.8.5, so not affected yet. But a shipped Champ Sage build cannot carry the dev-only `--owepm-packages-url=localhost` and will need signing. [CONFIRMED] **Implication: retiring the localhost override is likely forced before first distribution, independent of the live test.**

## Recommended sequence

### Step 1 (now, unconditional): ship the loud floor-sourced healthcheck

Observation only. Changes nothing about resolution, so it cannot regress the working override. Build:

- `fetchGepFloor(gameId, fetcher)`: GET the status endpoint, parse `min_gep_version_electron` and the `augments` feature state. Soft: returns null on any failure (degrade to today's behavior, never hard-fail).
- `evaluateGepHealth({loadedVersion, floor, augmentsState, isStub}) -> {level: green|warn|red, reason}`: pure, TDD'd red-first alongside the existing `decideGuardAction`/`manifestIndicatesOutage` tests. Red when `loadedVersion === "0.0.0"` OR `isStub` OR `compareVersions(loaded, floor) < 0`; warn when `augmentsState !== 1`; else green.
- Pre-queue check in `electron/main.ts` inside the existing `packages.on("ready")` handler for gep: fetch the floor, **stat the `.owepk` size** (not just the version string, this is what catches a stub reporting a healthy version), call `evaluateGepHealth`, `sendToAllWindows("gep-health", verdict)`.
- Runtime non-attach detector: latch `augmentsAttached = true` inside the existing `setRequiredFeatures(...).then(...)` ("Required features set"). Arm a ~20-25s timer on the **GEP-independent overlay `game-injected` event** (it fires regardless of GEP because the overlay is version-gated separately); if it elapses with `augmentsAttached` still false, emit the degraded verdict. Reset cleanly on overlay `game-exit` (this codebase has prior stale-overlay-state bugs).
- Preload `onGepHealth` mirroring `onGepInfoUpdate`, consumed by a small dismissible `<GepHealthBanner/>` (<50 lines, presentational): "Augment coaching unavailable this game: GEP vX is below League's required vY. Build and item coaching still work." Hidden on green.
- `--healthcheck` CLI mode in the guard: read the floor + cached `.owepk` size/version and print a verdict + exit code, so the live test is one watchable command. Also extend `--check` to log a loud WARN to `.ow-guard.log` when the resolved served version is below the floor.

Why: this is the one point all four design approaches converged on independently, it is investigation open-question #7, and it is what makes the retirement test safe to run. Even if everything else is deferred, the user stops discovering augment death mid-game.

### Step 2 (now, parallel): send the upstream ask

Channel: `developers@overwolf.com` (the DevRel team) plus the Overwolf Developers Discord (`discord.gg/overwolf-developers`). The whitelist PDF names no account manager or SLA, so send to both. Non-blocking, no SLA, may go unanswered, which is exactly why it runs in parallel and never gates the engineering. Full drafted message in "The upstream ask" below.

Why: the CONFIRMED verdict is that Overwolf's blessed resolution structurally cannot defend the OWEPM-side failure modes, so the deepest fix (delete the override) depends on Overwolf changing or blessing something, not on a client pattern we lack. It is also the only way to settle the production-distribution compliance question.

### Step 3 (after Step 1 ships, across one patch): run the guard-off live test

HITL: the user must run it on the real Windows ow-electron with a running League client across a real patch boundary. An agent cannot. This is the single deciding experiment for the two questions that gate retirement: does OWEPM re-stub a good cache under a healthy manifest, and does it auto-advance past a raised floor on its own. Full protocol in "The live-test kit" below.

### Step 4 (after the test, and/or an Overwolf reply): decide retire-or-keep

Pre-committed branch map (so the outcome maps cleanly to an action):

- **PASS** (or an adopted Overwolf mechanism): delete the active override machinery (localhost server, cache purge, CDN discovery walk, the `--owepm-packages-url` block in `launch-electron.sh`), keep the healthcheck forever. The guard collapses from ~700 lines + a localhost server + cache mutation to a read-only floor-vs-version compare plus a banner.
- **FAIL-restub** or **FAIL-floor**: keep the every-launch override as-is; the healthcheck has already made the failure loud. Keeping it is not a regression, it works today.
- **Reactive trigger + bounded relaunch**: build **only** if the test shows _intermittent_ re-stub that every-launch handles worse. Otherwise never, the cross-process relaunch handshake is the most fragile piece in any proposal and its sole justification is the very behavior the test measures.

Re-run the code-review gate on the exact retirement commits before merging (large deletion touching the launcher).

## What to build / retire / keep

**Build now:** `fetchGepFloor`, `evaluateGepHealth`, the pre-queue + runtime healthcheck, `onGepHealth` + `<GepHealthBanner/>`, the `--healthcheck` CLI, the `--check` floor cross-check WARN.

**Retire on PASS only:** `serveOverrideManifest` + `buildOverrideManifest` (localhost server), `discoverLatestVersion` + `maxLiveInLine` + the gep `PACKAGE_SPECS` baseline (the CDN walk that created the 307.0.x blind spot), `reconcilePackageCache` + `planCacheReconciliation` (cache mutation, the riskiest part), `decideGuardAction`, and the `--owepm-packages-url` block in `launch-electron.sh` plus its `--check`/`--serve` invocation.

**Keep forever (never a retirement target):** `evaluateGepHealth`, `fetchGepFloor`, the healthcheck, the banner, and the read-only cache primitives (`resolvePackagesDir`, `readCachedGep`, `isStubOwepk`).

**Do not build unless a specific test outcome demands it:** the auto-relaunch sentinel, the sticky-state file, the launcher-owned retry loop.

## How this respects the settled constraints (grill results)

- Manifest-seed fix kept as-is; not redone. The optional floor-anchored discovery touches only the FALLBACK path. [respected]
- The deferred `{306,0,0}` baseline bump is NOT done by hand. The optional floor-anchored discovery closes that residual at runtime (anchor discovery to the floor's `(major,minor)` line only when discovery is reached), without ever bumping the baseline. [respected, and resolves the residual]
- No absolute-version pin. [respected]
- No "do nothing when cache matches": Step 1 keeps the every-launch override; retirement is test-gated. [respected]
- Guard is temporary by design; retirement is sanctioned and is the explicit Step 4 PASS branch. [respected]
- Augment coaching is allowed under Riot/Overwolf rules; no prohibited tactical/map-state surface is touched. New nuance: the `--owepm-packages-url`-at-localhost compliance question for a distributed build (see the upstream ask). [respected, with a new latent gate surfaced]

## The decision forks (yours to make)

1. **Resolution posture.** Keep manifest-seed as primary + thread the live floor into the discovery FALLBACK only (recommended: lower risk, tier 1 already serves `307.4.7` correctly); OR move to floor-primary resolution ("walk up from `min_gep_version_electron` to the first live CDN build"), which is more robust against the exact `0.0.0` failure but reworks the shipped fix for an outage-only benefit.
2. **What to build first.** Minimal test-enablement (`--healthcheck` CLI + an `OWEPM_OVERRIDE_DISABLE=1` short-circuit) so you can start the 2-week live test immediately, then build the banner + detector while it runs (recommended); OR the full healthcheck package in one go before testing.
3. **Floor-anchored fallback now, or leave the residual deferred?** It closes the last manual-baseline-bump residual cheaply and softly (null floor keeps today's behavior), but it assumes the status endpoint stays readable during a packages-manifest outage, which was never proven for the 2026-05-29 incident.
4. **Overlay/utility pin refresh.** Refresh 1.12.5/2.7.5 to the manifest-current 1.13.12/2.8.5 now that the manifest is healthy, or leave until one rotates off the CDN. Tangential to augments, but the overlay is load-bearing for the new timeout detector.
5. **Retire-before-distribution.** Given mandatory signing + "remove `--owepm-packages-url` for PROD," is retiring the override a hard requirement before the first distributed build, independent of the live test?

## The live-test kit (HITL, you run it)

**Setup** (real Windows ow-electron + running League client): add an `OWEPM_OVERRIDE_DISABLE=1` short-circuit in `scripts/launch-electron.sh` that skips the `--check`/`--serve` block, so ow-electron launches with NO `--owepm-packages-url` and OWEPM resolves natively against Overwolf's real manifest (healthy today at `gep 307.4.7`). Delete the local cache ONCE to exercise cold start: `/mnt/c/Users/<user>/AppData/Roaming/ow-electron/<appHash>/packages/`. Then leave it untouched. Run `pnpm ow-guard --healthcheck` before each session for the pre-game prediction.

**Watch four signals per launch:**

1. `owpm.log` (under `.../ow-electron/<appHash>/logs/`): resolved version; did OWEPM download ~19 MB or hit "LocalStorage package discoverer" (cache hit); did it ever pull a stub?
2. The cached `.owepk` size at `.../packages/hhideknibngookbhmhalphpipjeogcfefhobblkk.owepk`: ~19 MB real vs ~21 KB stub. The direct re-stub check.
3. `gep/gep.log`: any "Detected GEP Version X is lower than the minimum allowed version: Y" reject; live `"featureName":"augments"` updates when working.
4. The champ-sage game log (`/mnt/c/Users/<user>/AppData/Roaming/champ-sage/logs/champ-sage-*.log`, newest mtime): "League detected" + "Required features set" when a game runs. **Ground truth**; the `--healthcheck` is the prediction.

**Duration:** at least 5-10 launches spanning AT LEAST one League patch boundary (~2 weeks). A few days inside one patch tests only re-stub, not floor self-heal, and is not sufficient to retire.

**Outcomes:**

- **PASS** (retire the override): every launch leaves a real ~19 MB `.owepk` (no re-stub under a healthy manifest), AND after the next patch raises the floor, OWEPM pulls a >= floor build within its update window + restart, and the game log shows "Required features set." Both of the override's justifications are gone.
- **FAIL-restub** (keep the override): any launch leaves a ~21 KB stub under a healthy manifest, re-confirming the 2026-06-13 clobber. Re-stub is the sole reason the override must run every launch. Only if intermittent, consider the reactive trigger.
- **FAIL-floor** (keep the override): after a patch, OWEPM stays below floor across restarts and never auto-pulls a floor-clearing build.
- **INCONCLUSIVE** (keep override, keep testing): no patch boundary observed yet, or mixed results. Do not retire on re-stub evidence alone; the floor self-heal across a patch is the harder, more important half.

## The upstream ask (drafted)

> Subject: [Whitelisted partner] GEP package resolution breaks League augment events ~every patch: is there a supported floor-clearing / stable-latest mechanism?
>
> Hi Overwolf DevRel,
> We are a whitelisted ow-electron partner building a League of Legends augment-coaching app (Arena/Mayhem augment offer and pick events via GEP). GEP is our only source of augment events; everything else rides Riot Live Client Data / LCU, so when GEP fails to attach, augment coaching goes dark silently while the rest of the app looks healthy. Over the last month it has broken on roughly every League patch, and each time our only remedy has been a client-side workaround around package resolution. Our setup is canonical: ow-electron 39.6.1, `"overwolf": { "packages": ["gep","overlay"] }` (bare names, matching ow-electron-packages-sample), OWEPM resolving against electronapi.overwolf.com/packages and pulling binaries from electrondl.overwolf.com/<channel>/<version>/module.owepk. We have reproduced four distinct failure modes and want the supported way to avoid them, ideally one that does not require a code change every patch.
>
> 1. Manifest 0.0.0 outage. From ~2026-05-29 to ~2026-06-13 the packages manifest advertised "0.0.0" for every package and OWEPM downloaded a ~21 KB GEP stub instead of the real ~19 MB module; the stub never fires game-detected. What caused the ~2-week outage, what is your monitoring/recurrence posture, and is there a status or incident page for the packages manifest and CDN themselves (distinct from the per-game game-events-status health endpoints)?
> 2. Version floor. League raises GEP's minimum-compatible version about every patch; a cached GEP that worked last patch is rejected at attach (gep.log: "Detected GEP Version X is lower than the minimum allowed version: Y" then "game status is disabled, not starting handler for game"). No event reaches us, so this mode is fully silent. We found min_gep_version_electron on https://game-events-status.overwolf.com/5426_prod.json (currently 307.4.2). Is that the intended, supported public signal for the floor? Is it guaranteed to update at or before a Riot patch goes live, or can it lag? Is there a supported way for OWEPM to always load a build at or above that floor automatically?
> 3. Recovered manifest, stub binary. After the manifest recovered to a real version, OWEPM still re-downloaded a ~21 KB stub over a known-good ~19 MB cached binary on later launches (observed 2026-06-13: a second app instance clobbered a real 306.0.10 cache back to a stub). Why does OWEPM replace a valid cached binary with a stub, is this an integrity-verification gap, and does the new 39.8.x Dev Mode / mandatory-signing integrity path change this behavior?
> 4. Discovery / CDN rotation. Old builds are rotated off the CDN (older versions 403) and version lines are non-contiguous: the entire 307.0.x line is 403 while 307.1.1 through 307.4.7 are live, with no version listing and no latest alias on the CDN. Is the packages manifest the canonical "current recommended version" pointer we should always trust now that it has recovered, is there (or could there be) a stable production channel or latest alias for GEP, and why is 307.0.x entirely 403?
>
> The core question: is there a supported mechanism, today or planned, by which an ow-electron app always loads a GEP build that (a) is never the 0.0.0 stub, (b) is at or above the current per-game floor, and (c) is not re-stubbed over a good cache? If it exists or can be enabled for whitelisted partners, we retire our workaround immediately.
>
> Compliance question: our interim workaround points --owepm-packages-url at a localhost manifest listing the real, still-hosted binaries. That flag is documented for the DEV/QA endpoint and "to be removed for PROD." For a distributed desktop build, is pointing it at a self-hosted corrected manifest acceptable, or is there a production-sanctioned equivalent? Happy to share logs, the full drift timeline, and our resolution code.

## Failure-mode coverage (the end state, post-retirement)

| Failure mode            | Detected by (healthcheck)                                  | Remediated by                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0.0 outage            | `loadedVersion === "0.0.0"` at `ready`, OR `.owepk` < 1 MB | Loud warning; OWEPM-native recovery when the manifest heals. Override re-enableable via flag as a recovery lever if recurrences are frequent.        |
| Version floor           | `compareVersions(loaded, min_gep_version_electron) < 0`    | OWEPM auto-update pulls a >= floor build (healthy manifest's latest is by construction >= floor) within its update window + restart. No code change. |
| Recovered-manifest stub | `.owepk` size < 1 MB (version-independent backstop)        | Same as 0.0.0. Whether OWEPM still PRODUCES this under a sustained-healthy manifest is the central test question.                                    |
| Discovery blind spot    | n/a (eliminated by construction)                           | Deleting the CDN walk removes it; OWEPM uses the manifest's exact advertised version, never a baseline walk.                                         |

## Open questions and spot-checks

- **Floor-field latency after a brand-new patch is unverified.** The documented ~10 min propagation is for `state`, not `min_gep_version_electron`. A pre-queue check could be briefly wrong in the first hours of a fresh patch (read a stale, too-low floor and miss a just-raised one), backstopped loudly but post-queue by the runtime timeout detector. Acceptable?
- **Spot-check the floor field before wiring:** eyeball `min_gep_version_electron` vs `min_gep_version` on the live JSON and decide which is authoritative if they ever diverge (use `_electron`).
- **Spot-check the stub-at-`ready` assumption:** it rests on a single 2026-06-13 game log. Ensure the in-app check stats the `.owepk` size, not just the version string.
- **Spot-check the overlay pin:** the timeout detector arms off the overlay `game-injected` event; confirm the overlay still injects on ow-electron 39.6.1 with the pinned 1.12.5 build.
- **Re-run the review gate** on the exact final commits for the healthcheck work (touches `electron/main.ts` cross-process, the preload, and the guard); verify the banner does not render on green and does not leak a stale warning across games.

## Review packet (how this conclusion was reached)

- **Work split:** 4 parallel recon agents (Overwolf/OWEPM docs; sample-repo + changelog; outage/whitelist forensics; attach/healthcheck primitives) -> 6 adversarial claim verifications -> 4 competing design proposals (retire-or-reduce, reactive-guard, read-the-floor, upstream-first) -> 1 synthesis. Every agent got the same ground-truth brief and the read-the-damn-docs discipline (cite primary sources; do not answer from memory).
- **Decision log (forks taken during synthesis):** demoted the reactive auto-relaunch sentinel from a step to a contingency (premature against an unrun test); took read-the-floor's floor-seeded-baseline idea but dropped its full 3-tier `resolveGepVersion` rework (tier 1 already serves correctly); folded a `.owepk`-size stat into the in-app `ready` check (a pure version compare misses a stub reporting a real version); surfaced the stale overlay/utility pin divergence as a spot-check.
- **Verified by hand, not trusted from the digest:** the floor endpoint (`min_gep_version_electron` = 307.4.2, `state` 1); the manifest (`gep 307.4.7`, healthy, no `url` field, `lastUpdateUTC`); the CDN boundary (307.4.7 live, 307.4.8+/307.5.x/308 = 403; 306.0.10 live but below floor); `is_vgep: false` for League; all four pins CDN-live.
- **One agent failure, recovered:** the platform-docs recon agent's structured output dropped its large nested arrays (a tool-serialization limit), so its recorded result was a degenerate `area:"test"` probe. Its full findings were recovered from its transcript (it had inlined them into the summary field) and folded in here; no re-run was needed. Its territory was also heavily covered by the sample-repo and attach agents by design.
