# Spike: Extracting ARAM Mayhem (KIWI) augment descriptions from raw CommunityDragon

Status: complete. Date: 2026-06-20.

## Verdict

**FEASIBLE.** ARAM Mayhem (codename KIWI) augment descriptions can be extracted directly
from CommunityDragon's raw game data, with no dependency on the human-edited wiki. The text
resolves to real English (with the same `@token@` fidelity ceiling the curated Arena file
ships with), the PoC reproduces it for both shared and Mayhem-only augments, and the PBE
branch carries next-patch augments before the live data updates.

The only reason this is not a trivial drop-in is that Mayhem augment data lives in a
**different raw file** from Arena, and the upstream CDTB toolbox does not export a curated
KIWI file the way it does for Arena and TFT. We have to read three raw endpoints and join
them ourselves. The PoC does exactly that in ~250 lines.

## Why the wiki was the bottleneck (and why this fixes it)

The app currently sources Mayhem augment descriptions from the wiki module
`Module:MayhemAugmentData/data`, which is hand-edited and lags days to weeks after each
patch. Riot ships the authoritative description strings inside the game files; CommunityDragon
mirrors those raw files and (for some modes) pre-resolves them into curated JSON. Arena gets a
curated file. Mayhem does not. So the strings exist upstream the moment a patch lands, but no
one had pointed the resolution logic at the KIWI data. This spike does.

## How Arena descriptions are generated (the model we replicated)

Source of truth: CDTB (CommunityDragon Toolbox), `cdtb/arenadata.py`, which is the code that
generates `cdragon/arena/en_us.json`. Its recipe:

1. Read `data/maps/shipping/map30/map30.bin` (Summoner's Rift Arena map bin).
2. Take every entry whose record type is `AugmentData`.
3. Each `AugmentData` carries `DescriptionTra` / `AugmentTooltipTra` / `NameTra` fields whose
   values are **string-table keys** (e.g. `Cherry_ADAPt_Summary`), not literal text.
4. Each augment's `RootSpell` points to a `SpellObject`; its `mSpell.DataValues` array holds
   the numeric substitution values (e.g. `APAmp = 0.15`).
5. For each language, load the RST string table and replace the `name`/`desc`/`tooltip` keys
   with their resolved text. CDTB leaves `@placeholder@` tokens and `mSpellCalculations` raw;
   it does **not** compute calculations.

That is the entire model. The curated `cdragon/arena/en_us.json` `desc` field still contains
`@token@` placeholders to be resolved against `dataValues`. Our job for KIWI is the same shape,
pointed at a different bin.

## Where KIWI augments actually live (the key finding)

We confirmed the asymmetry the spike brief flagged, and found the real location.

- `cdragon/arena/` and `cdragon/tft/` are the only curated mode dirs. There is **no
  `cdragon/kiwi/`**. So Mayhem descriptions are not pre-resolved anywhere by CDragon.
- The Arena Cherry exporter reads `map30.bin`. We downloaded its raw JSON
  (`game/data/maps/shipping/map30/map30.bin.json`, ~19 MB) and counted **253 `AugmentData`
  records, of which 0 have the `ARAM_` prefix**. None of the 170 catalog `ARAM_` apiNames
  appear as `AugmentData` there. Mayhem augments are **not** in the Arena map bin.
- `map12.bin` (Howling Abyss / ARAM) contains `AugmentPool` references like
  `Maps/ModeSpecificData/Augments/ARAM_ApexInventor`, but **0 `AugmentData` records**. It
  points at the data; it does not hold it.
- The actual database is **`game/maps/modespecificdata/kiwi.bin`**. There is a parallel
  per-mode structure here: `cherry.bin`, `kiwi.bin`, `brawl.bin`, `nexusblitz.bin`, etc.
  The KIWI bin holds **220 `AugmentData` records**, every one with a resolvable
  `DescriptionTra` and a `RootSpell` -> `SpellObject` -> `DataValues` chain.

This refactor (mode augment data moving into `maps/modespecificdata/<mode>.bin`) is also why
CDTB has not shipped a KIWI exporter: its Arena exporter still hardcodes the `map30.bin` path.
Arena's `cherry.bin` exists too but only carries 47 records, so map30 remains canonical for
Arena. For KIWI, `kiwi.bin` is the only source.

## Exact endpoint URLs

Live (`latest`); swap `/latest/` -> `/pbe/` for next-patch data.

| Purpose                                                   | URL                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Unified catalog (id/apiName/icon/rarity, no descriptions) | `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json` |
| KIWI augment database (raw bin, JSON-decoded)             | `https://raw.communitydragon.org/latest/game/maps/modespecificdata/kiwi.bin.json`                            |
| English string table (RST, JSON-decoded)                  | `https://raw.communitydragon.org/latest/game/en_us/data/menu/en_us/lol.stringtable.json`                     |

Sizes (live, 2026-06-17 snapshot): catalog ~135 KB, kiwi.bin.json ~12 MB, stringtable ~28 MB.
The stringtable is the heavy fetch; in production it would be cached per patch.

## Resolution recipe (what the PoC does)

1. From `cherry-augments.json`, map `id` -> `augmentNameId` (the apiName). KIWI entries have
   `augmentNameId` starting `ARAM_` and/or `kiwi/` in the icon path. Note the catalog's `name`
   is itself an unresolved string key (`nameTRA`); the readable name comes from the stringtable.
2. From `kiwi.bin.json`, collect every record with `__type === "AugmentData"`, indexed by
   `AugmentNameId`. Each record exposes `DescriptionTra`, `AugmentTooltipTra`, `NameTra`
   (string-table keys), `RootSpell` (a local `{hexhash}` reference), and
   `AugmentPlatformId` (which equals the catalog `id`).
3. Follow `RootSpell` to the same-bin `SpellObject`, read `mSpell.DataValues`, and build a
   `name -> values[0]` map. Mayhem augments have no per-level scaling (all array entries are
   equal), so index 0 is sufficient.
4. Resolve `DescriptionTra` / `AugmentTooltipTra` / `NameTra` against the string table. CDragon
   already de-hashes most RST keys back to their **lowercased readable name**, so look up the
   key lowercased. Keys it could not reverse remain `{hexhash}` and simply miss.
5. Substitute `@token@` placeholders: `@Name@` -> the DataValue, `@Name*N@` -> DataValue times
   constant `N` (e.g. `@APAmp*100@` for a percent). Computed tokens (`@f1@`,
   `@...CalcTooltip@`, quest tokens) come from `mSpellCalculations` / runtime and are left raw,
   exactly as CDTB leaves them in the curated Arena output.

## Proof (extracted text vs wiki)

Run on live data via `pnpm spike-kiwi`. Markup stripped here for readability.

### ARAM_ADAPt (id 1205) - shared augment, reuses Arena's string

- Raw `desc`: "Convert Bonus Attack Damage to Ability Power. Gain 15% Ability Power."
- Wiki (`MayhemAugmentData`): "Convert all of your bonus attack damage into ability power at a
  rate of 1 ability power per 0.6 bonus attack damage. Additionally, increase your ability
  power by 15%."
- Match: yes (semantic). The 15% comes from `APAmp = 0.15`; the wiki's "1 per 0.6" is the
  `InverseRate = 0.6` DataValue. Same numbers, different phrasing.

### Droppybara (id 1414, `Dropybara_Active`) - Mayhem-only, Prismatic

- Raw `desc`: "Gain Droppybara as a Summoner Spell. After a delay, call down a capybara that
  deals 30% max Health true damage."
- Wiki: "Replace a summoner spell with Droppybara... This augment is only offered to up to 1
  player on each team for a given game."
- Match: yes. The 30% comes from `DamagetoChampions = 0.3`. The raw text is arguably _more_
  precise than the wiki, which defers the damage number to a sub-template.

### Hand of Baron (id 1389, `HandOfBaron`) - Mayhem-only, Prismatic

- Raw `desc`: "Gain 25% Adaptive Force. Nearby allied minions are greatly empowered."
- Wiki: "Gain a modified Hand of Baron, which only grants 25% increased adaptive force and
  greatly empowers nearby allied minions."
- Match: near-exact. The 25% comes from `AFAmp = 0.25`.

All three reproduce from raw CDragon data alone, no wiki involved.

## PBE freshness result: PBE leads

Run via `pnpm spike-kiwi -- --pbe`.

- `kiwi.bin.json` last-modified: **PBE 2026-06-19, live 2026-06-17** (a 2-day lead at sample
  time).
- PBE carries **221** KIWI `AugmentData` records vs **220** live. The extra augment is
  `SupportMain` (id 2108, "Support Main"), present in the PBE catalog and PBE bin but **absent
  from the live mode bin**.
- Its PBE description resolves fully: "QUEST: Heal allied champions for @QuestRequirement@
  Health. REWARD: Any healing you provide now also Heals Over Time after the initial heal."

So next-patch Mayhem augments appear in resolvable form on PBE before they reach live, and well
before the wiki is updated. This is the freshness payoff the spike set out to verify.

## Honesty pass: edge cases, brittleness, cost

### Resolution coverage (measured on all 220 live KIWI augments)

- **Description string resolution: 220 / 220 (100%).** Every augment's `DescriptionTra` key
  resolves to English text. Zero missing strings.
- **Placeholder coverage: ~79% of `@tokens@` substitute directly** (120 of 152 across all
  descriptions). The remaining ~21% (32 tokens across 27 augments) are computed/quest/sub-spell
  tokens (`@f1@`, `@...CalcTooltip@`, `@QuestRequirement@`) that CDTB also leaves raw. They
  appear far more often in `tooltip` than in the short `desc`. For coaching, the `desc` field
  is the cleaner input and is what we'd use.
- Implication: the short summary (`desc`) is production-quality as-is. The detailed `tooltip`
  occasionally shows an unresolved bracket token, which is cosmetic and identical to what the
  curated Arena file does.

### Float noise

Riot's DataValues carry binary-rounding noise (`0.30000001...`). The PoC rounds substituted
values to 4 dp and trims, so `@DamagetoChampions*100@` renders `30`, not `30.000001`. Trivial.

### Brittleness (the real cost driver)

1. **Per-patch path drift.** The load-bearing path is
   `game/maps/modespecificdata/kiwi.bin.json`. If Riot renames the mode codename or moves the
   bin, extraction breaks. This is the same brittleness class CDTB lives with for Arena
   (`map30.bin` is hardcoded). Mitigation: a startup sanity check that the file exists and has
   `> N` AugmentData records, falling back to the wiki/placeholder on failure.
2. **Record-type field names.** We rely on `__type === "AugmentData"` and the field names
   `DescriptionTra`, `RootSpell`, `DataValues`. CDragon de-hashes these; if a future bin schema
   leaves them as `{hexhash}` we'd need the hash constants (recoverable from CDTB, which already
   carries them). Low probability, recoverable.
3. **String-table key casing.** CDragon de-hashes RST keys to lowercase. We lowercase lookups.
   If a key is one CDragon cannot reverse, it stays `{hexhash}` and misses; we'd fall back to
   placeholder for that one augment. Currently zero such misses on descriptions.
4. **Computed tokens.** Fully resolving `@f1@` / `CalcTooltip` tokens would require
   implementing `mSpellCalculations` evaluation, which CDTB itself does not do. Not worth it:
   the `desc` field does not need it.

### Effort estimate to productionize

Small. The PoC already does the join. To ship:

- Move the three-endpoint fetch + join into a `src/lib` ingest module (mirrors the existing
  data-ingest pattern), behind the existing localStorage versioned-cache layer keyed by patch.
  The 28 MB stringtable fetch is the one heavy call; cache it per patch.
- Add the startup sanity guard (file exists, record count sane) with wiki/placeholder fallback,
  consistent with the project's existing guard patterns (see `project_gep_stub_guard`).
- Keep the wiki module as a fallback and as a cross-check oracle, not the primary source.

Rough size: comparable to one of the existing ingest modules. A few hundred lines plus tests.
The hard part (finding the bin and proving resolution) is done.

### Cost vs status quo

Status quo: wiki + "No description available yet." placeholder, lagging each patch by days to
weeks, with manual wiki edits as the gating dependency. This approach removes that dependency
entirely, makes descriptions available the moment a patch lands (or earlier via PBE), and costs
one cached 28 MB fetch per patch plus a small ingest module. The freshness win is the headline:
PBE descriptions are available before the wiki even knows the augment exists.

## Recommendation

Productionize it. Point a new mode-augment ingest module at
`game/maps/modespecificdata/kiwi.bin.json` + the cherry catalog + the en_us string table,
resolve `desc` (not `tooltip`) for coaching input, substitute `@token@`/`@token*N@` from
DataValues, and keep the wiki as a fallback/oracle. Add a per-patch cache and a sanity-check
guard with graceful fallback. Optionally read the PBE branch to surface next-patch augments
ahead of live. The 21% of computed tooltip tokens are acceptable to leave raw, matching the
fidelity Riot/CDragon themselves ship for Arena.

## Reproduce

- PoC: `scripts/spike-kiwi-augment-descriptions.ts` (read-only, self-contained).
- `pnpm spike-kiwi` - live, default augments (ADAPt, Droppybara, Hand of Baron).
- `pnpm spike-kiwi -- --pbe` - PBE branch.
- `pnpm spike-kiwi -- 2108 1414` - specific augment ids.
- Oracle for cross-check: `https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw`.
