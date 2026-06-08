# Patchline data channel

How live and PBE augment data coexist in Champ Sage without clobbering, and how the offline eval harness reuses the same ingest code. Written with the architect-deep vocabulary: module (interface + implementation), seam (where an interface lives), adapter, leverage (what callers gain), locality (what maintainers gain).

"Patchline" is Riot's own term for the live/PBE choice in the launcher (the `patchlines` key in `RiotClientInstalls.json`). It unifies the data side (which CommunityDragon branch) and the client side (which region the launcher selected) under one word.

## Deletion test: what earns a module

Each candidate was run through "if this never existed, would complexity vanish or concentrate across callers?"

**Built (complexity concentrates, so the module earns its keep):**

- **Patchline.** Keep it. The test: imagine it never existed; the meaning of "pbe" (which cdragon branch, which cache namespace) would scatter across the fetch site, the cache-key site, and the future region-detection site, and drift apart. Concentrating that meaning in one place is the win.
- **Augment patchline report.** Keep it. The test: without it, the comparison logic (id-diff vs name-diff, mode partitioning, and the "what would production silently drop" computation) lives inline in a script's `main()`, untestable, and gets re-implemented the day a "PBE readiness" view is wanted in-app. This is the deep module and the test surface.

**Not built (the deletion test says complexity would not concentrate; recorded so they are not re-suggested):**

- **A pure `assembleGameData` extraction.** The harness operates at the raw-source level (it must, to see the augments production drops), and in-app assembly runs in the renderer where `localStorage` is fine. That leaves one real production caller: a hypothetical seam, not a real one.
- **A persistence port over the cache.** One production adapter (localStorage); the harness persists a report file, not a `GameData`. One adapter is indirection, not a seam. `cache.ts` stays a plain module; patchline-scoped keys are built at the call site by the Patchline module.

## Modules

### Patchline (in-process, no port)

- **Interface:** `Patchline = "live" | "pbe"`; `cdragonBranch(p)` (live to `latest`, pbe to `pbe`); `patchlineCacheKey(p)` (`game-data:live` / `game-data:pbe`). Total functions over the union, no error modes.
- **Hides:** the mapping from the launcher/Riot concept to a data-source branch and a storage namespace.
- **Leverage:** every fetch or cache site names a patchline, never a raw `"latest"` string or a hand-built cache key.
- **Locality:** renaming a branch or adding a tournament patchline is one edit here.
- **Test surface:** table test over the two values.
- File: `src/lib/data-ingest/patchline.ts`.

### Augment patchline report (in-process, no port)

- **Interface:** one entry point, `buildAugmentPatchlineReport({ base, candidate, wikiAugments, knownSetNames, mode? })`. Inputs are the two raw cdragon augment arrays, the wiki augment map for the mode (which carries `sets[]`), and the hardcoded set names. Output partitions for the mode (Mayhem default): `addedById`, `addedByName`, `removed`, `rarityChanged`, `droppedForMissingDescription` (deduped, mirrors the production merge's drop rule), `addedMissingWiki` (the PBE-introduced description gap), `wikiCoverage`, and `grouping` (`wikiSetMembershipCount`, `repurposedSetNames`). Pure, deterministic, no I/O, no clock.
- **Hides:** id-vs-name reconciliation, mode classification reuse, and the "what would production drop" calculation.
- **Leverage:** the script is a thin wire; the same report can later back an in-app readiness view with no re-derivation.
- **Locality:** every comparison rule lives in one tested place. New icon folder or new rarity lands here.
- **Test surface:** feed two small hand-built arrays plus a wiki map; assert the partitions. No network.
- File: `src/lib/data-ingest/augment-patchline-report.ts`.

### Patchline thread (refactor, not a new module)

`community-dragon.ts` takes a `patchline` (default live) and exposes `fetchCDragonAugments(patchline)` plus `normalizeForMatch`. The hardcoded `latest` moves into the Patchline module. Live behavior is unchanged.

### Eval script

`scripts/eval-pbe-augments.ts` (`pnpm eval-pbe`): fetch wiki names once, fetch cdragon for live and pbe, call the report, print the summary, write namespaced dumps to `data-dump/{live,pbe,diff}/`. It imports neither `cache.ts` nor `localStorage`. That is the coexistence guarantee at the harness level: it shares zero state with the running app, so no eval run can lose data from or corrupt a live game.

## Coexistence at the app level (designed, deferred to step 2)

When PBE data is used inside the app:

- `loadGameData(patchline)` caches under `patchlineCacheKey(patchline)`, so live and pbe occupy separate localStorage slots that coexist.
- Selection is driven by **`detectPatchline()`** (region `PBE` to pbe, else live), never a manual mode flag. Playing a live game means the app connects to the live client, detects live, loads the live slot, and the pbe slot sits untouched. The thing that would break that scenario, a global toggle you forget to flip, is designed out: the connected client decides.
- `detectPatchline` is the one **true-external** dependency (the LCU). It gets a port with a real LCU adapter and an in-memory test adapter. Two adapters, a real seam. Design-it-twice when it is built.
- Bump `CACHE_VERSION` (currently 3) to give symmetric keys and one harmless refetch on upgrade.

## Scope limits of the diff

From cdragon we can detect roster changes, rarity changes, id reassignments, and mode reclassification, plus the grouping-repurposing heuristic. We cannot detect tooltip/value/description changes to existing augments: cdragon raw carries no descriptions, the wiki lags PBE, and the only resolved-description aggregate is Arena-only. So the report's readiness signal is roster + rarity + wiki-coverage + grouping, not balance-number diffs.

## Related

- Data-source details and the live snapshot: `docs/reference/technical-reference.md` (Data Sources, PBE patchline).
