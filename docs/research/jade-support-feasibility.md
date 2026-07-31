# Jade support feasibility (KIWI_JADE and Classic Rift)

Read-only investigation, 2026-07-30. Every architectural claim cites `file:line`. Facts are tagged
VERIFIED (read in this repo, or fetched live from DDragon / CommunityDragon during this
investigation) or INFERRED (reasoned from verified facts, not observed directly).

Companion work: a parallel agent is determining which champion kit and which item pool each mode
actually uses at runtime. This report treats that as a parameter and answers for both branches.

---

## Verdict and headline cost

**(b) Moderate. One real architectural change, and only if Classic Rift is in scope.**

The single architectural change is **champion identity**: the champion map is keyed by lowercased
display name (`data-dragon.ts:63` in the jade worktree), and the sixty `Jade_*` entries carry a
`name` byte-identical to their canonical counterpart, so the map structurally cannot hold both. The
runtime never sees anything but a display name either (`src/lib/game-state/types.ts:39`, `PlayerInfo`
has `championName` and no raw/internal id), so lookup has to become mode-aware, not just storage.
That is a change to how a champion is addressed across roughly a dozen call sites, not a new case in
a switch.

Everything else the user described really is cheap, and the user's framing is mostly right:

- The mode registry is a plain first-match-wins list (`src/lib/mode/registry.ts:11-16`), so a new
  mode is pure addition. No switch to extend.
- The mode-constant switch surface in the whole app is **five sites**: `selectMetaFile`
  (`src/lib/ai/item-catalog.ts:47-56`), `modeAcceptsItemMode` (`src/lib/ai/item-catalog.ts:124-128`),
  two `mode.matches(...)` checks in `base-context.ts` (lines 70 and 88), and the Practice-Tool map
  table in `detect.ts:16-20`. VERIFIED by grepping every `GAME_MODE_*` reference outside
  `mode/types.ts` and `mode/index.ts`.
- The item partition is a two-line addition to `classifyItemMode`
  (`src/lib/data-ingest/sources/data-dragon.ts:321-327`) plus one member on the `ItemMode` union
  (`src/lib/data-ingest/types.ts:86`). The legacy shop is a clean, self-contained `77xxxx` id
  namespace (VERIFIED: 162 entries in DDragon 16.15.1).
- **Meta build data is not a blocker.** The tier-2-only path already works by construction and the
  legacy shop yields a healthy 78-item catalog. Details in section 3.

The user's stated worry ("the only hard part is having the right amount of data so we can choose
which items to give to the prompt") is the part that turns out to be **easiest**. The part they did
not mention, telling two champions named "Ashe" apart, is the actual cost.

**Scope split that changes the verdict:**

| Scope                                     | Champion variant work needed? | Verdict                 |
| ----------------------------------------- | ----------------------------- | ----------------------- |
| KIWI_JADE only, IF it uses canonical kits | No                            | **(a) straightforward** |
| KIWI_JADE only, IF it uses Jade kits      | Yes                           | **(b) moderate**        |
| Classic Rift (3260/3262/4300-4321)        | Yes, unavoidable              | **(b) moderate**        |

CommunityDragon's queue metadata says KIWI_JADE uses **canonical** champion keys while Classic Rift
uses **Jade** keys (VERIFIED data, section 2). If that holds at runtime, shipping KIWI_JADE alone is
a ticket you can write today.

---

## 1. Architecture seams, costed

### 1a. `GameMode` interface and the registry: pure addition, one latent trap

VERIFIED. `GameMode` (`src/lib/mode/types.ts:45-53`) is `id`, `displayName`, `decisionTypes`,
`augmentSelectionLevels`, `matches(gameMode: string)`, `buildContext(gameState, gameData)`. The
registry is a list scanned in registration order, first match wins
(`src/lib/mode/registry.ts:11-16`). Registration is three lines in `src/App.tsx:82-84`. Adding a mode
costs a new file modelled on `aram-mayhem.ts` (74 lines) plus one register call. Nothing switches on
mode identity inside the registry.

**Trap, conditional on Classic Rift being in scope.** `matches` receives only the mode string
(`types.ts:51`). If the standalone Classic Rift queues report the literal string `CLASSIC`, then
`classicMode.matches("CLASSIC")` returns true (`src/lib/mode/classic.ts:21-22`) and the registry
hands back Summoner's Rift: modern item catalog, modern champion kits, on a legacy-shop map. That is
a **silent wrong answer**, strictly worse than today's honest decline. The interface cannot express
"CLASSIC on map 453" without widening `matches` to take the map number (or a small session
descriptor). This is a second, smaller architectural change, and it is gated entirely on what
Classic Rift reports as its `gameMode` string. UNVERIFIED: nobody has observed a live Classic Rift
session's Live Client `gameMode` value.

If KIWI_JADE is the only scope, this trap does not fire. `KIWI_JADE` matches no registered mode
today (VERIFIED: the three registered modes match exactly `KIWI`, `ARAM`, `CLASSIC`), and the
worktree fix at `.claude/worktrees/fix-jade-patch/src/lib/mode/detect.ts:92-99` gates the map
fallback on the session actually being Practice Tool, so `KIWI_JADE` correctly falls through to
`unrecognizedGameMode` and the banner.

### 1b. `item-catalog.ts`: two new cases, but the default is wrong-by-default

VERIFIED. Two mode-identity chains:

- `selectMetaFile` (`item-catalog.ts:42-57`) falls through to `return null` (line 56). A new mode
  gets no meta file. **Safe default.**
- `modeAcceptsItemMode` (`item-catalog.ts:123-129`) falls through to `return itemMode === "standard"`
  (line 128). A new mode silently accepts the modern Summoner's Rift catalog. **Wrong default**, and
  it does not error, it just produces a confidently wrong prompt.

That asymmetry is worth naming in the ticket: adding a Jade mode without touching
`modeAcceptsItemMode` produces a coach that recommends Heartsteel in a 2013 shop. The fix is one
case (`if (mode.matches(GAME_MODE_MAYHEM_JADE)) return itemMode === "jade";`), but the failure mode
if it is forgotten is invisible.

`isBuildPathEligible` (`item-catalog.ts:100-115`) itself needs no change. Its structural rules
(purchasable, not consumable/trinket, completed-or-boots, >= 500g, `maps.length > 0`) applied to the
`77xxxx` namespace yield **78 items** (VERIFIED against live DDragon 16.15.1): Atma's Impaler,
Deathfire Grasp, Force of Nature, Madred's Bloodrazor, Wriggle's Lantern, Spirit of the Ancient
Golem, and so on. That is unmistakably the 2013 shop, it is above `check-buildpath-enum.ts`'s
`HEALTHY_FLOOR = 50`, and far under the schema's 500-value enum cap. The game-plan build-path enum
(`src/lib/ai/features/game-plan/index.ts:123`) derives from the same predicate and therefore follows
automatically.

`scripts/check-buildpath-enum.ts:48-57` hardcodes its three modes and would need the new one added,
otherwise the guard silently stops covering the mode it most needs to cover.

### 1c. `classifyItemMode` and the `maps` field: partition works, `maps` does not

VERIFIED, live DDragon 16.15.1 item.json:

- `77xxxx` range: 162 entries. 151 of them flagged available on map 12 AND map 453. Exactly one
  (`771500` Penetrating Bullets) is also flagged on map 11.
- Map 453 carries 416 flagged items total: 151 legacy plus **265 modern standard-range items**
  (Heartsteel, Cryptbloom, Dawncore, Experimental Hexplate all included).
- Arena-range and ARAM-range items carry zero map-453 flags.

**ANOMALY worth reporting.** DDragon's `maps` field cannot separate the legacy shop from the modern
shop in either direction:

- It says map 453 (Classic Rift) sells essentially the entire modern SR catalog alongside the legacy
  one. For a mode whose whole premise is the 2013 shop, that is almost certainly wrong.
- It says map 12 (which hosts regular ARAM, Mayhem, and Mayhem Classic-ish simultaneously) sells the
  legacy shop, which would be wrong for two of those three modes.

This is the same class of unreliability already documented for ARAM in
`docs/reference/technical-reference.md:486`, but the failure is inverted: there `maps` was too
restrictive, here it is too permissive. The practical consequence is that the **id namespace is the
only usable discriminator**, exactly as `classifyItemMode` already does for arena and aram. So:

```
if (id >= 770000 && id < 780000) return "jade";
```

plus `"jade"` on the `ItemMode` union (`src/lib/data-ingest/types.ts:86`). Two lines.

`ModeContext.modeItems` (`src/lib/mode/types.ts:60`), built via `filterItemsByMode` in every mode
file, would then work for a Jade mode with `filterItemsByMode(gameData.items, "jade")`. Note this
field is currently near-dead: grepping every consumer shows it is constructed in all three mode
files and read nowhere in the prompt path. The real item gate is `isBuildPathEligible`. Do not spend
design effort on `modeItems`.

**Second anomaly, more dangerous.** Of the 78 eligible legacy items, **47 share an exact name with a
modern item** (VERIFIED by set intersection: Guardian Angel, Banshee's Veil, Wit's End, Last
Whisper, Infinity Edge, Trinity Force, Zhonya's Hourglass, and 40 more). The legacy versions are
genuinely different:

```
3035  Last Whisper  1450g  20 AD, 18% armor pen
773035 Last Whisper 2300g  40 AD, "Piercing Volley: ignore 35% of opponent's armor"
```

Two consequences.

First, `dedupeByName` (`item-catalog.ts:140-159`) collapses same-named items keeping the one with
the most `maps` entries. If a Jade catalog ever contains both namespaces, the **modern** item wins
(it is flagged on 11/12/21/35/453 versus the legacy 12/453) and the model is handed the wrong stats
and cost under the right name. Keeping the two namespaces strictly disjoint per mode avoids this
entirely, which is another reason to partition by id rather than by `maps`.

Second, the LLM's own priors are modern. `base-context.ts:35` already instructs "Prioritize the game
data provided in this prompt over your general knowledge", which is the right mitigation and already
exists. Good news for the user's framing: DDragon carries **full, accurate legacy descriptions** for
the `77xxxx` entries (with a new `<jadeUnique>` tag that `stripHtml` at `data-dragon.ts:339-345`
strips generically without any change). So "generically providing information about the items" is
genuinely already solved by the existing pipeline.

### 1d. `fetchChampions` and the ability merge

VERIFIED (jade worktree, `src/lib/data-ingest/sources/data-dragon.ts:40-98`). The landed fix
excludes any champion whose DDragon id contains `_` (line 40-42), counts the skips, and warns on any
surviving name collision (lines 79-95). Supporting Jade means reversing that exclusion for the modes
that need it. This is the invasive seam; see section 2.

`mergeChampionAbilities` (`src/lib/data-ingest/index.ts:419-443`) keys by `champion.id.toLowerCase()`
rather than the map key, precisely because the map key is a name. VERIFIED that
`championFull.json` ships all sixty `Jade_*` entries with complete passive and spell payloads, so
`abilities.get("jade_ahri")` resolves with **zero change** to this function. That is a genuine
piece of luck: whoever wrote the id-keyed merge made the Jade case free.

The kits really do differ. VERIFIED: 24 of the 60 Jade champions differ from canonical at the level
of ability NAMES (Ashe's passive is Focus not Frost Shot; Sion's Q is Cryptic Gaze not Decimating
Smash; Kayle, Taric, Pantheon, Warwick, Skarner, Sion all carry their pre-rework kits). Jade Ahri's
R cooldown is 110/95/80 versus canonical 140/120/100. So merging the two rosters is not cosmetic:
serving the wrong kit is a materially wrong coaching prompt for at least a third of the roster.

`mergeAbilityScaling` (`index.ts:83-112`) and `fetchChampionAbilityScaling` are keyed by lowercased
champion **name** (`src/lib/data-ingest/sources/wiki-champion-abilities.ts:179-182, 211-214`). Two
problems if Jade entries enter the champion map:

- `fetchAndCache` passes `[...champs.values()].map(c => c.name)` (`index.ts:291`), which would send
  60 duplicate names to the wiki.
- If Jade champions were keyed by name, the modern wiki scaling would land on legacy kits. If they
  are keyed by anything else, scaling simply misses and Jade prompts render cooldown/cost/range
  without scaling. The latter is the correct degrade; the wiki has no legacy-kit pages to scrape
  anyway.

`mergeAramOverrides` (`index.ts:469-479`) keys by the champion map key, so a non-name-keyed Jade
entry gets no ARAM balance overrides. Whether ARAM overrides even apply to KIWI_JADE is UNVERIFIED.

Two coverage gates use `champions.size` as a denominator: `ABILITY_MIN_COVERAGE_RATE`
(`index.ts:394-403`) and `reportScalingCoverage` (`index.ts:450-467`). Adding 60 entries to the same
map shifts both denominators. The ability gate would still pass (Jade entries resolve abilities), but
scaling coverage would drop by roughly 26% and trip the warning at `index.ts:461` permanently. That
is a real "noisy warning that trains you to ignore warnings" outcome and needs a deliberate answer.

### 1e. `base-context.ts`: three touch points, two of them wrong-by-default

VERIFIED.

- Line 54-55: `gameData.champions.get(gameState.activePlayer.championName.toLowerCase())`. This is
  the single most important call site in the whole question. It must become mode-aware.
- Line 70: `const isAramFamily = mode.matches(GAME_MODE_ARAM) || mode.matches(GAME_MODE_MAYHEM)`.
  A Jade mode is not in the family, so balance overrides are omitted. Probably correct for Classic
  Rift, UNVERIFIED for KIWI_JADE (it is played on map 12 with augments).
- Line 88: `if (!mode.matches(GAME_MODE_MAYHEM))` renders the runes line. A Jade mode defaults to
  "has runes". If KIWI_JADE has no runes (like Mayhem), the prompt renders `Runes:  ( / )`, the
  exact bug commit 05c8882c67 fixed for Mayhem.
- Lines 121 and 132: roster tag lookups, same name-keyed map, same mode-awareness problem, but
  degrading only to `tags: "unknown"`.

The pattern across 1b and 1e is worth stating plainly: **`mode.matches(CONSTANT)` is
capability-detection-by-identity.** Every such site expresses a capability (has augments, has runes,
has balance overrides, which item namespace, which meta file) as a list of mode names. A new mode is
invisible to all of them and inherits whatever the fallthrough happens to be. There are only five
sites, so converting them to declared capabilities on `GameMode` is a small, optional refactor. It is
not required for Jade, but it converts "silently wrong" into "compiler tells you what to fill in",
which matters because Riot has now shipped two new modes in one patch.

---

## 2. The champion-variant problem

### What the data actually says

VERIFIED, live DDragon 16.15.1 `champion.json`:

- 233 total entries, 60 of them `Jade_*`.
- Jade `key` = 60000 + canonical key, universally. Checked all 60: every `key - 60000` resolves to a
  real canonical champion.
- Jade `name` is byte-identical to canonical.
- **One id-suffix mismatch:** `Jade_Wukong` (key 60062) corresponds to canonical `MonkeyKing`
  (key 62). So deriving the canonical id by stripping the `Jade_` prefix breaks for exactly one
  champion. Deriving it by `key - 60000` never breaks. Any implementation must use the arithmetic,
  not the string.

VERIFIED, live CommunityDragon queue metadata (`viableChampionRoster` per queue):

```
2450  ARAM: Mayhem Classic-ish   roster 60, keys [81, 27, 86]        <- canonical
3280  ARAM: Mayhem Classic-ish   roster 60, keys [81, 27, 86]        <- canonical
3260  Classic Rift (blind)       roster 60, keys [60081,60027,60086] <- Jade
3262  Classic Rift (draft)       roster 60, keys [60081,60027,60086] <- Jade
4300-4321  Jade queues           roster 60, keys [60081,60027,60086] <- Jade
2400  ARAM: Mayhem               roster 173, canonical
450   ARAM                       roster 173, canonical
```

Same file, same field, two different encodings, drawn from the same 60-champion pool. INFERRED
(strong): **Mayhem Classic-ish restricts the champion pool to the sixty legacy champions but plays
them with modern kits**, while the standalone Classic Rift queues use the legacy kits. If that holds,
KIWI_JADE needs **no champion-variant work at all**: the existing name-keyed map answers correctly,
and only the item pool is legacy. This is the parallel agent's question and their runtime observation
should be treated as authoritative over this metadata inference.

### The three options, evaluated against every consumer

I enumerated every read of the champions map (29 call sites, all of the form
`champions.get(name.toLowerCase())` or `champions.values()`).

**Option A: second keyed map.** `LoadedGameData.jadeChampions: Map<string, Champion>`, name-keyed,
holding the 60 variants. Every existing consumer is untouched, so it cannot regress anything. The
`.values()` iterators (entity dictionary at `entity-dictionary.ts:27`, `champion-id-map.ts:15`,
match-history `resolveChampionName` at `src/lib/match-history/store.ts:100-105`, the wiki scaling
fetch at `index.ts:291`, both coverage denominators) keep their current semantics for free. Cost: a
parallel structure future code must remember exists, and a cache-shape change in `CachedGameData`
(`index.ts:179-187`) and `fromCached` (`index.ts:481-496`).

**Option B: composite key in the same map** (`"jade:ashe"`). Attractive because it is one map, and
name lookups never collide (nothing asks for `"jade:ashe"` by accident). But it silently poisons
every `.values()` iteration listed above: the entity dictionary gains 60 duplicate champion names in
fuzzy search, the wiki scaling fetch issues 60 duplicate requests, and both coverage gates shift
their denominators (see 1d). Each of those is individually fixable, and each is a place where
forgetting is silent. **Not recommended.**

**Option C: per-mode resolver.** `GameMode.resolveChampion(gameData, displayName): Champion |
undefined`. This is the access-side answer and it is what the code shape actually wants, because at
runtime the app has **only** a display name plus a mode: `PlayerInfo.championName`
(`src/lib/game-state/types.ts:39`) is the sole champion identifier and the Live Client's
`rawChampionName` is not captured anywhere (VERIFIED: zero grep hits across `src/` and `electron/`).
Mode is the only available disambiguator.

**Recommendation: A plus C, treated as one change.** They answer different halves. A is where the
variants live; C is how a caller who knows the mode gets the right one. Neither alone suffices: A
alone leaves 12 mode-aware call sites still calling `champions.get(name)` and getting the modern
kit; C alone has nothing to resolve into.

Concretely: `GameMode` gains one method with a default implementation that reads `gameData.champions`
(so `aram`, `aram-mayhem`, and `classic` are one-line changes), and the Jade mode overrides it to
read `gameData.jadeChampions`. Mode-aware call sites that switch to the resolver: `base-context.ts`
lines 55, 121, 132; the three `buildContext` implementations (`aram-mayhem.ts:32`, `aram.ts:34`,
`classic.ts:33`); `context-assembler.ts` lines 20 and 268; `useCoachingContext.tsx:69`;
`EnemyStrip.tsx:61`; `build-direction/stream.ts:43`; `enemy-stats-reactive.ts:38`;
`GamePlanPanel.tsx:29`. Mode-unaware consumers (`ChampionList`, `EntitySearch`, `SimulatorPanel`,
`entity-dictionary`, `dump-data`) keep reading the canonical map and are correct to.

**One consumer becomes better, not worse.** `champion-id-map.ts:11-22` keys by numeric key, so 103
and 60103 coexist without collision. Feeding it the Jade entries makes `resolveChampionName(60081)`
work, which is what the LCU sends during champ select in a Classic Rift queue (roster is 60xxx). It
currently returns undefined. Same for match-history's `resolveChampionName`
(`store.ts:98-105`), a linear key scan that would resolve Jade participants correctly.

---

## 3. Meta-build data (the user's main worry)

### (a) What the upstream source is, and whether it has anything for Jade

VERIFIED. Meta builds come from **Riot's Match-v5 API**, harvested by
`scripts/fetch-meta-builds.ts`. The collected queues are hardcoded at lines 90-99: `ranked-solo`
420, `aram` 450, `arena` 1750. Output lands in `src/data/meta-builds/*.json`, loaded by
`loadMetaBuilds` via a Vite glob (`src/lib/data-ingest/meta-builds.ts:117-173`) into the three-slot
`MetaBuildIndex` (`meta-builds.ts:94-98`). On disk today: `aram.json` (2.9 MB, 2026-07-06),
`ranked-solo.json` (2.9 MB, 2026-04-16), plus staging `.new.json` files.

Nothing exists for Classic Rift or any Jade queue, and nothing in the pipeline could produce it
without a code change (the queue table, the `MetaBuildIndex` shape, and `selectMetaFile` all name
their three queues explicitly).

Two hard signals that Riot does not expose these queues:

- VERIFIED: Riot's static `queues.json` lists 450 (ARAM) and 2400 (ARAM: Mayhem) and does **not**
  contain 2450, 3280, 3260, 3262, or any of 4300-4321. That is the same pattern the repo already
  hit with Arena 1750 (`fetch-meta-builds.ts:94-98`: Riot moved Arena to a new queue id and never
  updated `queues.json`), so absence from the static file is weak evidence on its own.
- VERIFIED (as a repo record, not re-tested): `fetch-meta-builds.ts:83-88` documents that Mayhem
  queue 2400 returns **403 Forbidden** from Match-v5, that Mayhem games get reclassified as queue
  450 with augment data stripped, and that Riot confirmed this in developer-relations issue #1109.

INFERRED (strong): the Jade queues are in the same category as Mayhem, that is, not exposed. Not
proven. I attempted a live Match-v5 probe and was blocked from reading the API key from `.env`, so
this stays unverified. See open questions.

### (b) Harvest Classic Rift and reuse it for Mayhem Classic-ish?

**Not viable now. Possibly viable later, and only under a condition that currently looks false.**

Three independent blockers, in increasing order of how badly they bite:

1. **Access.** If `queue=3260` returns 403 like 2400 does, the idea is dead at step one. UNVERIFIED,
   and it is a five-minute check (see open questions).

2. **Volume.** The repo's own coverage study (`docs/reference/technical-reference.md:686`, measured
   on 87k cached ARAM matches) puts the working bar at **~200 games per champion** for a stable item
   pool, and notes that at N=40 roughly 2 of every 12 pool items are noise. A mode that has been live
   for a couple of days, spread across 60 champions and a dozen sibling queues, will not be near
   that. Worse, the collector's discovery is a snowball seeded from high-elo ranked players
   (`collectMatchesSnowball`, lines 772+) who mostly do not play a two-day-old LTM, so reachability
   is poor even where volume exists.

3. **Transfer validity.** Reusing ARAM data for Mayhem works because they share a shop and share
   kits; only the augment layer differs. Classic Rift to Mayhem Classic-ish shares neither
   necessarily: the CommunityDragon rosters (section 2) say one uses Jade kits and the other uses
   canonical kits. An item pool built on 2013 Ashe with 2013 items may or may not transfer to modern
   Ashe, and if Mayhem Classic-ish turns out to use the modern shop as well, the transfer is
   backwards entirely. This blocker is the one that does not go away with time.

Net: park it. If the mode survives and Riot exposes the queue, revisit with the volume bar in hand.

### (c) Can a mode work with NO meta build data? Yes, verified by construction

**This is the answer that unblocks the whole feature, and it is already true today.**

Trace, all VERIFIED:

1. `selectMetaFile(mode, index)` returns `null` for any mode that matches none of the four constants
   (`item-catalog.ts:56`).
2. `getChampionMeta(null, key)` returns `null` (`meta-builds.ts:180-186`).
3. `deriveMetaItemPoolEntries(null)` returns `[]` (`meta-builds.ts:209-212`).
4. `tier1Items` is therefore empty, and `buildItemCatalogSections` skips the tier-1 block
   (`item-catalog.ts:332`) and emits only "## Other available items"
   (`item-catalog.ts:345-355`).
5. The function returns `text: null` only when **both** tiers are empty (`item-catalog.ts:326-328`).

Tier 2 for a Jade mode is 78 items (VERIFIED count against live DDragon under the exact
`isBuildPathEligible` rules), each rendered with name, key stats, and cost via `formatReferenceItem`
(`item-catalog.ts:241-246`). That is a complete, accurate, legacy-correct shop reference. The
game-plan build-path enum derives from the same 78 names, above the guard's healthy floor of 50 and
far under the 500 cap.

So: **Jade support is not blocked on meta data.** Ship tier-2-only. Two caveats:

- The tier-2 section's lead-in reads "Additional items available in this game mode. Reach for these
  when the game state calls for something the pool above doesn't address"
  (`item-catalog.ts:349`), which is incoherent when there is no pool above. Small copy fix,
  conditional on `tier1Items.length > 0`.
- **`selectMetaFile` must be left returning null for Jade, deliberately.** If KIWI_JADE resolves
  canonical champion keys (section 2), then wiring it to `index.aram` "because it is ARAM-family"
  would inject modern item names into tier 1 while tier 2 lists the legacy shop, and the prompt tells
  the model everything in the catalog is purchasable. The safe default here happens to be correct;
  do not "improve" it. Worth a test that pins it.

Related, and reassuring: if a Jade mode ever does resolve Jade champion entries (key 60103), then
`getChampionMeta(file, 60103)` misses every existing meta file and degrades to tier-2-only
automatically. The 60000 offset gives free isolation from the modern meta data.

---

## 4. Verdict, with slices

**(b) Moderate**, on one architectural change: **champion identity becomes mode-scoped** (a second
name-keyed variant map on `LoadedGameData`, plus a `resolveChampion` method on `GameMode`), because
the name-keyed map cannot hold two "Ashe" and the runtime only ever has a display name.

Downgrade to **(a) straightforward** if the parallel agent confirms KIWI_JADE uses canonical kits and
Classic Rift is out of scope. Then the work is a new mode file, an item-namespace partition, and
three switch cases.

Not (c). Nothing here needs a design conversation: the data is clean, the seams are few and named,
and the fallback behaviour (tier-2-only) already works.

### Slice list

Ordered so each slice is independently shippable and the risky one is not first.

**Slice 0 (prerequisite, not code).** Observe one live KIWI_JADE session and record: Live Client
`gameMode` string, `mapNumber`, whether `activePlayer.runes` is populated, one player's
`championName`, and the item ids in a player's inventory (a `77xxxx` id settles the shop question
outright). This is the parallel agent's deliverable; slices 2 and 4 branch on it.

**Slice 1: item namespace partition.** `"jade"` on the `ItemMode` union
(`src/lib/data-ingest/types.ts:86`), one branch in `classifyItemMode`
(`data-dragon.ts:321-327`). No behaviour change for existing modes (the range was previously
`"other"`, which no mode accepts). Test: 162 items classify as `"jade"`, and no existing mode's
eligible set changes size.

**Slice 2: the mode itself.** `src/lib/mode/jade-mayhem.ts` matching `KIWI_JADE`, registered in
`App.tsx`. Cases in `modeAcceptsItemMode` (returns `itemMode === "jade"`) and a pinned test that
`selectMetaFile` returns null. Runes and balance-override handling in `base-context.ts` lines 70 and
88 set from slice 0's observation. Add the mode to `scripts/check-buildpath-enum.ts:48-57`. At the
end of this slice, a KIWI_JADE game is coached with the correct legacy shop and (per the roster
inference) the correct modern kits. **If slice 0 says canonical kits, you are done here.**

**Slice 3: champion variant storage.** Stop excluding `Jade_*` in `fetchChampions`
(`data-dragon.ts:58-61`); route them into a second name-keyed `jadeChampions` map. Carry it through
`CachedGameData` (`index.ts:179-187`) and `fromCached` (`index.ts:481-496`). Keep the existing
collision warning (`data-dragon.ts:90-95`) pointed at the canonical map. Explicitly decide the
denominators for `ABILITY_MIN_COVERAGE_RATE` (`index.ts:394`) and `reportScalingCoverage`
(`index.ts:450`) rather than letting them drift. Do NOT pass Jade names to
`fetchChampionAbilityScaling` (`index.ts:291`); the wiki has no legacy-kit pages and it would be 60
duplicate requests returning modern data. Verify `mergeChampionAbilities` picks up all 60 via
`jade_*` ids with no change. Use `key - 60000` anywhere a canonical counterpart is needed, never the
id suffix (`Jade_Wukong` / `MonkeyKing`).

**Slice 4: mode-scoped resolution.** `GameMode.resolveChampion(gameData, displayName)` with a
default reading `gameData.champions`; Jade mode overrides. Convert the ~12 mode-aware call sites
listed in section 2. Feed `populateChampionIdMap` both maps so 60xxx champ-select ids resolve.

**Slice 5 (only if Classic Rift is in scope): mode detection by map.** Widen `matches` (or add a
session descriptor) so `CLASSIC` on map 453 resolves to Classic Rift rather than Summoner's Rift.
Do not ship slices 3 and 4 for Classic Rift without this: a Jade roster served through
`classicMode` is exactly the silent-wrong-answer case the current decline avoids.

**Optional follow-up, not required:** convert the five `mode.matches(CONSTANT)` capability checks to
declared fields on `GameMode` (`hasAugments`, `hasRunes`, `hasBalanceOverrides`, `itemNamespaces`,
`metaFile`). Turns "new mode silently inherits a wrong default" into a compile error. Small (five
sites), and Riot just shipped two modes in one patch.

---

## Anomalies found (reported, not worked around)

1. **DDragon `maps` cannot separate the legacy shop from the modern shop, in either direction.**
   Map 453 is flagged for 265 modern standard-range items on top of the 151 legacy ones; map 12 is
   flagged for the legacy shop even though two of the three modes on that map do not have it. This
   is a new instance of the unreliability recorded at
   `docs/reference/technical-reference.md:486`, inverted (too permissive rather than too
   restrictive). It is worth appending to that note before any Jade work lands, since the existing
   note reads as "maps is only unreliable for ARAM".

2. **47 of the 78 build-eligible legacy items share an exact name with a modern item**, with
   materially different stats, costs, and effects (Last Whisper: 1450g/20 AD/18% pen versus
   2300g/40 AD/35% pen). `dedupeByName` (`item-catalog.ts:140-159`) would resolve such a collision
   in favour of the modern item if the two ever appear in one catalog. Keeping the namespaces
   disjoint per mode is what prevents it.

3. **`Jade_Wukong` breaks the `Jade_<canonicalId>` naming assumption** (canonical is `MonkeyKing`).
   Exactly one of sixty. The `key - 60000` arithmetic is reliable for all sixty; the string is not.

4. **`ModeContext.modeItems` is constructed by all three modes and read nowhere in the prompt
   path.** Not a Jade problem, but it is a field that looks load-bearing and is not, and someone
   adding a mode will reasonably spend effort on it.

5. **`modeAcceptsItemMode` defaults to the modern Summoner's Rift catalog** for any unrecognized
   mode (`item-catalog.ts:128`). A new mode that forgets this line gets a plausible, confidently
   wrong item catalog with no error. Contrast `selectMetaFile`, whose default (null) is safe.

---

## Open questions for the user

1. **Scope: KIWI_JADE only, or Classic Rift too?** This is the single decision that sets the
   verdict. KIWI_JADE alone, given the canonical-roster evidence, is a few new cases plus a data
   partition (slices 1 and 2), shippable as one ticket. Adding Classic Rift pulls in the champion
   variant work (slices 3 and 4) and the map-aware detection change (slice 5). Recommendation:
   **KIWI_JADE only, first.** It is the mode you are actually playing, it is the cheap half, and it
   validates the item partition against a real game before anyone touches champion identity.

2. **Is Match-v5 open for the Classic Rift queues?** I could not check: reading `RIOT_API_KEY` from
   `.env` was blocked. If you want this settled, run one request with a fresh dev key and tell me
   the status code:
   `curl -s -o /dev/null -w "%{http_code}\n" -H "X-Riot-Token: $KEY" "https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/<your-puuid>/ids?queue=3260&count=5"`.
   A 403 closes the meta-harvest question permanently; a 200 with an empty array means "exposed but
   unreachable at your volume", which is still a park. Either way it does not block slices 1 and 2,
   because tier-2-only is sufficient.

3. **Does KIWI_JADE have runes?** `base-context.ts:88` renders a runes line for every mode except
   Mayhem, and a mode without runes renders `Runes:  ( / )`, the bug commit 05c8882c67 fixed. If you
   have a KIWI_JADE game open, glance at whether the rune page is populated and tell me yes or no.
   Same trip: are your items' ids in the `77xxxx` range (legacy shop) or the `1000-8999` range
   (modern shop)? That one observation settles the shop question outright and is worth more than any
   amount of metadata inference.
