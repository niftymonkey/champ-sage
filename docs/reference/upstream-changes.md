# Upstream change ledger

Every time Riot changes data out from underneath us, it gets a row here.

This exists because the same failure kept repeating in a different costume: an
upstream change landed, nothing in the app complained, and we found out when a
player saw something wrong. Individually each one looked like a one-off. Read
together they are one recurring defect, and the point of writing them down is
to make the shared shape visible enough to design against.

**The shape, stated once:** every guard we had measured internal consistency
(what share of champions resolved abilities, what share of abilities carried
scaling numbers). None measured conformance to upstream. So a change that kept
our counts intact while changing what the counts referred to passed every check
we owned. The counter-measure is `pnpm audit-upstream-drift`, which compares
live upstream against `scripts/upstream-baseline.json` in terms of things that
cannot move without a human deciding to move them: id namespaces, map ids,
queue ids, entity counts.

## How to use this file

- Run `pnpm audit-upstream-drift` at every patch boundary, and any time the app
  behaves oddly in a mode that used to work.
- When it reports drift, investigate before shipping, then run with `--update`
  and add a row here.
- A row is worth writing even when nothing broke. The near-misses are the
  cheapest data we get.

## Row format

Each entry records: what changed upstream, how we found out, what it cost, what
we changed, and the one check that would have caught it earlier. That last
part is the whole point of the exercise.

---

## 2026-07-30: patch 16.15.1 shipped the Classic Rift ("Jade") mode family

**What changed upstream**

- `champion.json` grew from 173 to 233 entries. The sixty new ones are ids
  prefixed `Jade_`, keys at `60000 + canonicalKey`, carrying legacy base stats
  and legacy 2013-era ability kits, with a `name` byte-identical to the
  canonical champion.
- A new item namespace `77xxxx` (162 entries) holding the legacy shop:
  Sightstone, Ruby Sightstone, Madred's Bloodrazor, Deathfire Grasp.
- A new map id `453`, "Classic Rift" (mapStringId `JD`).
- New queues: `3260`/`3262`/`4300`-`4321` (Classic Rift) and `2450`/`3280`,
  "ARAM: Mayhem Classic-ish", which reports gameMode **`KIWI_JADE`** and is
  played on **map 12** with the legacy shop.
- Relabelled, noted while investigating: map `12` is now "Random Map" (was
  "Howling Abyss") and map `35` is "The Bandlewood", which is **Brawl**, not
  Mayhem.

**How we found out**

A player saw a post-game headline reading "Three takeaways from Champion 22",
and separately noticed that a game of "ARAM: Mayhem Classic-ish" produced
advice about items that were not in the shop.

**What it cost**

Two distinct defects, both silent:

1. `fetchChampions` keyed the map by lowercased `name`, so each `Jade_*` entry
   overwrote its canonical twin. 233 entries collapsed to exactly 173 unique
   names, and 173 is also the correct canonical count, so every count-based
   check and every log line read normal. Because the ability merge keys by
   `champion.id`, the poisoned entries then resolved `jade_ashe` and attached
   the **legacy ability kit**, so sixty champions were coached on abilities
   they do not have, in every game mode, with modern wiki scaling numbers
   stapled on top. Verified by rendering the real prompt: Ashe came back with
   passive "Focus" and a toggled "Frost Shot" Q.
2. `detectMode`'s `mapNumber` fallback existed only to disambiguate Practice
   Tool, but applied to any unmatched mode string. `KIWI_JADE` on map 12
   therefore resolved to plain **ARAM**: the catalog was the 120 modern items
   against a legacy shop, and because ARAM declares no augment decision type,
   augment coaching was skipped entirely even though GEP correctly reported
   five real augment picks. Nothing was logged.

**What we changed**

- `fetchChampions` skips variant ids (`_` separator, which no canonical
  champion id has ever contained) and logs the skipped count.
- A collision canary warns if two kept entries still share a name, so an
  unrecognized variant scheme announces itself instead of overwriting silently.
- `CACHE_VERSION` 7 to 10, because a payload written before the filter holds
  Jade data under canonical names and nothing about its shape reveals that.
- The `mapNumber` fallback is gated on the session actually being Practice
  Tool. `describeModeDetection` now reports an `unrecognizedGameMode`, which is
  logged once per game and surfaced to the player as a banner: coaching is off,
  the mode is unsupported, here is its name.
- Added `pnpm audit-upstream-drift` and this ledger.

**Deliberately not done**

Real support for the Jade modes (own item partition, own ability kits, augment
routing for `KIWI_JADE`). The app now declines to coach those modes rather than
coaching them wrongly. Tracked separately.

**What would have caught it**

`pnpm audit-upstream-drift`. Verified, not assumed: with the baseline pinned to
16.14.1, the audit run against live 16.15.1 reports the new `Jade_` prefix, the
new `77xxxx` namespace, the new map id 453 by name, and the 173 to 233 count
move. Any one of those is enough to start the investigation.

---

## Backfill: the same defect, four earlier costumes

These predate the ledger and are reconstructed from issues, commits and the
technical reference. They are here because the pattern only becomes obvious
when they sit next to each other.

### #144: champion ability information missing from coaching prompts

**Upstream reality:** `championFull.json` is a bulk ability endpoint. Our own
documentation asserted no bulk endpoint existed, so abilities were never
fetched in bulk and prompts shipped without them.

**Why it was silent:** the gap was in a written assumption, not in data. Every
pipeline stage did exactly what it was told; what it was told was wrong.

**What would have caught it:** not the drift audit. This one argues for a
different guard, and the one that exists now is `ABILITY_MIN_COVERAGE_RATE`:
assert that prompts actually carry the thing they are supposed to carry, rather
than trusting a doc comment. Prompt-content assertions are the counter-measure
for this class, and `pnpm dump-champion-prompt` is how you check by eye.

### #145: ARAM and Mayhem coaching could not recommend most items

**Upstream reality:** the item catalog for those modes collapsed to roughly 26
items, far below the real pool.

**Why it was silent:** nothing declared how many items a mode's catalog should
plausibly contain, so "26" and "122" were equally acceptable answers.

**What would have caught it:** a namespace count check. The drift audit now
flags a namespace that shrank, not just one that appeared, precisely because
this is the shape that reaches users as "the app suddenly knows nothing". This
case is covered by a dedicated test in `scripts/upstream-drift.test.ts`.

### #146: prompts described abilities but carried none of their numbers

**Upstream reality:** ability scaling is not in any Riot endpoint; it only
exists in the wiki, behind templates that change shape without notice.

**Why it was silent:** a wiki template rework degrades gracefully into empty
values, which look exactly like "this ability has no scaling".

**What would have caught it:** `SCALING_MIN_COVERAGE_RATE`, which now warns
when wiki-sourced scaling covers noticeably fewer abilities than usual. The
generalisable lesson is that any parser standing on someone else's markup needs
a coverage floor, because partial-parse failures are invisible by construction.

### #138: item mode-availability inferred from id ranges

**Upstream reality:** DDragon's per-map `maps` flags are incomplete for ARAM
(they mark real staples like Guardian Angel as absent from map 12), so we infer
mode availability from id ranges instead.

**Why it matters here:** id-range inference is exactly what hid the `77xxxx`
shop. `classifyItemMode` returns `"other"` for any unknown namespace, and
`"other"` is invisible to every catalog. The inference is still the right call
for the reason recorded in the technical reference, but it fails silently on a
namespace it has never seen, which is why the drift audit checks namespaces
directly.

**Status:** open. Still the tracked home for a map-accurate availability model.

---

## Known and deliberately unmodelled

Recorded so the drift audit's clean run is not mistaken for full coverage.

| Thing                                        | Status                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Map 453, Classic Rift, and the `77xxxx` shop | Known, unsupported. App declines to coach.                                                                                                                                                                                                       |
| Map 33, Swarm (`Strawberry`)                 | Known, out of scope.                                                                                                                                                                                                                             |
| Map 35, The Bandlewood, Brawl                | Known. Brawl data is off-limits per Riot policy. Note that #117's ARAM/Mayhem allowed-map set includes 35, which predates knowing 35 is Brawl. It is permissive-only and drops nothing, but it should be revisited.                              |
| Map 21, Nexus Blitz                          | Known, out of scope.                                                                                                                                                                                                                             |
| Queue-level drift                            | The audit reads CommunityDragon's latest for maps and queues, which publishes no per-patch archive, so `--version` pins only the DDragon half. A queue added between two runs is caught; one added before the baseline was first written is not. |
