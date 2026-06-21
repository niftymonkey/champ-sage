# KIWI (ARAM Mayhem) Augment Descriptions from Raw CommunityDragon Data

Status: Implemented. Design approved 2026-06-20.
Owner: data-ingest. Related research: `docs/research/kiwi-augment-extraction-spike.md`. Reference map: `docs/reference/technical-reference.md` ("Augment descriptions: where each mode's text comes from").

## Problem

New ARAM Mayhem (KIWI) augments stay description-less or stale for weeks after a patch. Cause: Mayhem augment text has exactly one source in the current pipeline, the hand-edited wiki module `Module:MayhemAugmentData/data`, which lags and is gutted then slowly rebuilt on every Mayhem rework. `cherry-augments.json` gives us the catalog (id/name/icon/rarity) fresh, but no text, so new augments surface with `MISSING_DESCRIPTION_PLACEHOLDER` ("No description available yet.") until a human edits the wiki.

A feasibility spike (proven, reproducible via `pnpm spike-kiwi`) found that Mayhem descriptions ARE machine-readable from CommunityDragon raw game data, fresh on patch day and ~2 days ahead on the `pbe` branch. This plan moves Mayhem descriptions onto that source and demotes the wiki to a fallback.

## What the spike proved (evidence)

- Source endpoints (per `{branch}` in `latest`/`pbe`):
  - Catalog: `.../{branch}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`
  - KIWI augment DB: `.../{branch}/game/maps/modespecificdata/kiwi.bin.json` (220 `AugmentData` records on live 16.12)
  - String table: `.../{branch}/game/en_us/data/menu/en_us/lol.stringtable.json` (~28 MB)
- Resolution: `AugmentData` records keyed by `AugmentNameId`; resolve `DescriptionTra`/`AugmentTooltipTra`/`NameTra` against the string table by LOWERCASED key; follow `RootSpell` to `mSpell.DataValues` (index 0) to substitute `@token@` and `@token*N@`.
- Coverage: `desc` resolves 220/220, ~79% of tokens substitute. The ~21% unresolved are computed/quest tokens (`@f1@`, `@QuestRequirement@`) CDTB itself leaves raw; they cluster in `tooltip`, not the short `desc`. `desc` is production-quality.
- Freshness: PBE `kiwi.bin` led live by 2 days and carried a PBE-only augment (`SupportMain` id 2108) that resolved fully.
- Oracle outputs (must keep matching): `ARAM_ADAPt` (1205), Droppybara (1414), Hand of Baron (1389). See research doc for the exact strings.

## Architectural decisions (architect-deep)

Canonical terms: module, interface, implementation, depth, seam, adapter, leverage, locality.

### The one deep module: `fetchKiwiAugments`

New source module `src/lib/data-ingest/sources/cdragon-kiwi-augments.ts`, parallel to `wiki-augments.ts`.

- Interface (single production entry point): `fetchKiwiAugments(patchline: Patchline = "live"): Promise<Map<string, Augment>>`. Returns fully-formed Mayhem augments keyed by lowercased display name, the SAME key convention `fetchWikiAugments` uses, so the existing merge in `index.ts` consumes it unchanged. Each `Augment`: `{ name, description (resolved desc, NOT tooltip), tier (from catalog rarity via the existing rarity->tier map), sets: [], mode: "mayhem", id, iconPath }`.
- Internal split: a pure `resolveKiwiAugments(catalog, kiwiBin, stringtable): Map<string, Augment>` (in-process, no I/O) plus a thin fetch wrapper that pulls the 3 endpoints for the patchline branch and delegates. Export the pure resolver for tests. The interface is the test surface: most tests exercise the pure resolver with inline fixtures, no fetch involved.
- What it hides (the concentrated complexity, its depth): the 3-endpoint join, `AugmentData` bin traversal, `RootSpell` to `mSpell.DataValues`, lowercased string-table resolution, `@token@`/`@token*N@` substitution and float-noise rounding, rarity to tier.
- Leverage: one body of resolution logic feeds the single augment map all coaching and UI consume; every Mayhem augment goes patch-day fresh and PBE-ahead at once.
- Locality: all Mayhem description extraction lives behind one interface. When Riot drifts the bin schema (the known brittleness), the break and its fix land in exactly one module, with the wiki fallback and cache fallback absorbing the gap meanwhile.

### Dependency classification and seams

- CommunityDragon raw HTTP (catalog, kiwi.bin, stringtable): TRUE EXTERNAL. Seam = global `fetch`, matching the existing data-ingest source convention (`wiki-augments.ts` calls `fetch` directly; its test stubs global `fetch` via `vi.stubGlobal`). No bespoke fetch port or adapter: a single production caller makes a port a hypothetical seam, not a real one. Tests stub global `fetch`.
- String resolution, token substitution, bin traversal: IN-PROCESS pure computation. No port. These are the testable core, reached with fixtures.

### Modules deliberately NOT created (pre-deletion test)

- No `StringTableResolver`: it is a one-liner (`table[key.toLowerCase()] ?? ""`); complexity vanishes if inlined. Keep it a private function.
- No shared token-substitution module YET: ~15 lines, one caller today. Extract to a shared in-process helper ONLY when the optional Arena curated phase (below) becomes the real second caller. (Noted so a reviewer does not re-suggest premature extraction.)
- No separate merge/precedence module: the precedence is orchestration glue and belongs in `index.ts` alongside the existing mayhem/arena merge.

### Precedence model (orchestration in `index.ts`, not a new module)

- Primary Mayhem source: `fetchKiwiAugments` (cdragon raw) replaces `fetchWikiAugments` as the source of Mayhem ENTRIES and descriptions.
- Fallback: `fetchWikiAugments` (wiki) fills the description for any Mayhem augment whose raw `desc` resolves empty, and supplies entries if the raw fetch yields nothing (resilience). Demoted from primary to safety net.
- Final fallback: `MISSING_DESCRIPTION_PLACEHOLDER` for an augment with no desc from either source (should approach zero in practice).
- `mergeAugmentIds` (community-dragon): Mayhem augments now arrive with id/icon already (catalog join inside `fetchKiwiAugments`), so its Mayhem-placeholder branch becomes a rarely-hit safety net. Arena still depends on it for id/icon. Keep it; it no-ops for kiwi entries that already carry id/icon.

### Brittleness guard (mirrors the GEP stub-guard pattern)

If the resolved Mayhem augment count or non-empty-`desc` rate drops below a threshold (start at: fewer than 90% of `kiwi.bin` `AugmentData` records resolve a non-empty `desc`), log a warning via the `data-ingest` logger and lean on the wiki fallback rather than shipping a gutted set. A hard throw is already covered by `fetchAndCacheWithFallback` serving the last cache.

## Current state (orientation for a cold start)

Augment ingest is assembled in `src/lib/data-ingest/index.ts` `fetchAndCache`:

1. Parallel fetch: `fetchWikiAugments()` (Mayhem, `Module:MayhemAugmentData`), `fetchArenaAugments()` (Arena, `Module:ArenaAugmentData`), plus champions/items/runes/aramOverrides.
2. Merge mayhem + arena into one `Map<string, Augment>` (name collisions get an `arena:` prefixed key).
3. `mergeAugmentIds(augments, patchline)` (`sources/community-dragon.ts`): fetch `cherry-augments.json`, merge id + iconPath by normalized name, add CDragon-only Mayhem augments with `MISSING_DESCRIPTION_PLACEHOLDER`.
4. `enrichQuestAugments`, `mergeAramOverrides`, `getMayhemAugmentSets` (returns `[]` post-26.12).
5. Cache assembled `CachedGameData` under `patchlineCacheKey(patchline)`.

Key types in `sources/.../types.ts`: `Augment`, `AugmentMode = "mayhem" | "arena" | "swarm" | "unknown"`. Patchline branch in `patchline.ts` (`cdragonBranch`). Source-test convention: stub global `fetch` with inline payloads (see `sources/wiki-augments.test.ts`). Lua/string normalization helpers live in `parsers/`.

## Implementation phases (TDD: red before green, every phase)

### Phase 0 (pre-flight, in the executing conversation)

- Branch is clean (handled separately by the user before execution starts).
- Run `pnpm spike-kiwi` and confirm the 3 oracle descriptions still reproduce. If the upstream bin schema has drifted since 2026-06-20, reconcile the spike first; the resolver mirrors it.

### Phase 1: pure resolver + tests

- Add `cdragon-kiwi-augments.ts` with a stub `resolveKiwiAugments` returning an empty map (compiles, fails assertions).
- Write `cdragon-kiwi-augments.test.ts` against the pure resolver using small INLINE fixtures (a handful of `AugmentData` records + matching string-table entries + catalog slice). All red first.
- Lift the proven resolution logic from `scripts/spike-kiwi-augment-descriptions.ts` (`entriesOfType`, `resolveString`, `substituteTokens`, `formatNumber`, `dataValuesForAugment`) into the module as private functions. Go green.

### Phase 2: fetch wrapper + patchline branch

- Add `fetchKiwiAugments(patchline)` that fetches the 3 endpoints for `cdragonBranch(patchline)`, throws on any `!ok` (existing convention), and delegates to `resolveKiwiAugments`.
- Test it by stubbing global `fetch` (per `wiki-augments.test.ts`): assert it threads the `pbe` branch into all 3 URLs and throws on `!ok`.

### Phase 3: wire into orchestration

- In `index.ts` `fetchAndCache`: make `fetchKiwiAugments` the primary Mayhem source; keep `fetchWikiAugments` as fallback (fill empty descriptions, supply entries only if raw yields none).
- Apply the final placeholder fallback and the brittleness guard.
- Confirm `mergeAugmentIds` still behaves (kiwi entries already carry id/icon; Arena path unchanged).
- Tests: cdragon-raw desc wins over wiki; wiki fills an empty raw desc; placeholder is last resort; guard trips below threshold and prefers wiki.

### Phase 4: validation

- `pnpm typecheck`, `pnpm test` green.
- Run the app (`pnpm dev:electron`) in a Mayhem context (or the existing offline harness) and confirm current-patch Mayhem augments show real descriptions, no blanket placeholders.
- Spot-check `pbe` branch surfaces next-patch Mayhem text.
- If eval scores are affected, run `pnpm eval` once at this phase boundary (eval-before-commit rule), not per edit.
- `technical-reference.md` already documents the source (done 2026-06-20). Update `CONTRIBUTING.md` only if a script entry changes.

### Phase 5 (OPTIONAL, separate, clearly marked): Arena curated source

- Switch Arena descriptions from wiki `Module:ArenaAugmentData` to `cdragon/arena/en_us.json` (desc + dataValues), wiki as fallback for the ~30 rotation entries it omits.
- At this point extract the shared token-substitution helper (the real second caller).
- Not required to solve the Mayhem problem; do only if Arena freshness is also wanted.

## Test list

Pure `resolveKiwiAugments` (inline fixtures):

- ADAPt 1205 (shared) resolves to the oracle desc.
- Droppybara 1414 and Hand of Baron 1389 (Mayhem-only) resolve to oracle descs.
- `@token*N@` multiplier substitutes (factor applied, float noise rounded).
- Unresolved `@token@` (no DataValue) passes through intact.
- rarity to tier mapping (`kSilver`/`kGold`/`kPrismatic`); unknown rarity falls back to Silver.
- Every returned augment has `mode === "mayhem"` and `sets: []`.
- An augment whose `DescriptionTra` misses resolves to empty `description` (so the fallback can fill).

Fetch + orchestration:

- `fetchKiwiAugments` threads `pbe` branch into all 3 URLs; throws on `!ok`.
- Raw desc wins over wiki; wiki fills empty raw desc; placeholder is last resort.
- Brittleness guard trips below threshold and prefers wiki.

## Risks and mitigations

- Bin schema drift per patch (hashed fields, record shape): guard + wiki fallback + `fetchAndCacheWithFallback` cache fallback. Phase 0 re-runs the spike to catch drift early.
- 28 MB string-table fetch per refresh: fetched once per patch like other sources, cached per patchline. Acceptable; revisit with HTTP cache headers if it bites.
- Catalog `nameTRA` vs wiki key mismatch for the fallback merge: reuse `normalizeForMatch`.
- The ~21% unresolved tooltip tokens: acceptable. Coaching uses `desc`; do not surface raw `tooltip`.

## Validation / acceptance criteria

- No Mayhem augment present in `kiwi.bin` shows `MISSING_DESCRIPTION_PLACEHOLDER` once ingest runs.
- `pbe` branch surfaces next-patch Mayhem descriptions before the wiki.
- A wiki outage no longer blanks Mayhem text.
- The 3 oracle augments match their spike outputs through the production path.
- `pnpm typecheck` and `pnpm test` green.

## Out of scope

- Arena description swap (optional Phase 5).
- Swarm augment support.
- Set/trait mechanics (removed in the 26.12 Mayhem rework).
- Changing the Arena id/icon merge.

## References

- Research / proof: `docs/research/kiwi-augment-extraction-spike.md`, `scripts/spike-kiwi-augment-descriptions.ts` (`pnpm spike-kiwi`).
- Source map: `docs/reference/technical-reference.md`, section "Augment descriptions: where each mode's text comes from".
- Current code: `src/lib/data-ingest/index.ts`, `sources/wiki-augments.ts`, `sources/community-dragon.ts`, `patchline.ts`, `types.ts`.
