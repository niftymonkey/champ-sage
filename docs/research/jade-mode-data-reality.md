# Jade mode data reality: which entities does each Jade mode actually use

Investigated 2026-07-30 against live CommunityDragon (`latest`) and DDragon 16.15.1.
Every claim below is labelled **VERIFIED** (read directly out of a cited endpoint or
file) or **INFERRED** (reasoned from verified facts).

## Verdict

There are two distinct Jade products, and they do NOT share an entity namespace.

|                       | **Classic Rift** (map 453, gameMode `JADE`, queues 3260/3262/4300/4301)                                  | **ARAM: Mayhem Classic-ish** (map 12, gameMode `KIWI_JADE`, queues 2450/3280)                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Champions / abilities | Jade legacy characters (`characters/jade_*`, ids 60xxx), 2013-era kits and base stats                    | **Modern characters** (ids 1..117), modern kits and modern base stats, restricted to the same 60 champions |
| Items                 | Legacy shop only: 150 ids in `771001..773521`                                                            | Legacy shop only: 150 ids in `771001..773521` (a slightly different 150)                                   |
| Augments              | None                                                                                                     | Yes: a dedicated 188-augment `KIWI_JADE` pool (163 shared with Mayhem, 25 exclusive)                       |
| Runes                 | Legacy runes + masteries (own client namespace: `jade-perks`, `jade-rune-pages`, `jade-mastery-display`) | None (modern perks suppressed, no Jade rune page binding found)                                            |
| Summoner spells       | Legacy spell namespace, ids 71..777 including Clairvoyance, Fortify, Rally, Surge, Promote, Revive       | Modern ARAM spell set, ids 1/4/6/7/13/14/21/32                                                             |

**The user's worry is confirmed, precisely.** In `KIWI_JADE` the items are the Classic
Rift shop but the champions are the modern champions with their modern abilities and
modern base stats. It is modern kits shopping in a 2013 store, with Mayhem-style
augments layered on top.

Practical consequence for us right now: our app resolved this game to plain ARAM.
From the live log `/mnt/c/Users/markd/AppData/Roaming/champ-sage/logs/champ-sage-2026-07-30_032030.log:116`:

```
Game detected: KIWI_JADE (lcu: KIWI_JADE, map: 12) | mode: ARAM | players: 10 | augments in data: 506
```

`GAME_MODE_MAYHEM = "KIWI"` in `src/lib/mode/types.ts:23` does not match `KIWI_JADE`, so
`detectMode` (`src/lib/mode/detect.ts`) falls through to `MAP_TO_MODE[12]` and lands on
ARAM. The coach therefore saw the modern ARAM item catalog (wrong shop) and no augment
handling (the game had augments). **VERIFIED.**

---

## 1. Champions and abilities

**Answer: `KIWI_JADE` uses the MODERN kit. Confidence: high, VERIFIED from five
independent static signals that all agree, with no contradicting signal.**

### Signal A: only the modern character bins carry `KIWI_JADE` data

The bin field/string hashing is FNV-1a 32-bit over the lowercased string. Confirmed by
matching `GameModeMapData.mModeName` values: `{ad33a648}` = `kiwi_jade`, `{20426d6f}` =
`jade`, `{bffdf499}` = `kiwi` (checked against
`https://raw.communitydragon.org/latest/game/data/maps/shipping/map12/map12.bin.json`
keys `Maps/Shipping/Map12/Modes/KIWI_JADE` and `Maps/Shipping/Map453/Modes/JADE`).
**VERIFIED.**

`https://raw.communitydragon.org/latest/game/data/characters/ashe/ashe.bin.json`
contains exactly one occurrence of `{ad33a648}`:

```json
{"mForceOverride":true,
 "mOverrideContexts":[{"mMapID":12,"mModeNameStringId":"{ad33a648}","__type":"ItemRecommendationOverrideContext"}],
 "StartingItemBundles":[{"items":["Items/773093","Items/771051"]}, ...]}
```

That is the MODERN Ashe character carrying a forced, KIWI_JADE-specific item
recommendation made of LEGACY item ids. **VERIFIED.**

I checked this across every champion:

- 60 / 60 modern character bins of the Mayhem Classic-ish roster carry the `kiwi_jade`
  recommendation context. **VERIFIED** (fetched all 60 from
  `https://raw.communitydragon.org/latest/game/data/characters/<alias>/<alias>.bin.json`).
- 0 / 113 modern character bins outside that roster carry it. **VERIFIED.**
- 0 / 60 `jade_*` character bins carry it. **VERIFIED.**
- 15 / 60 `jade_*` bins instead carry a `{"mMapID":453,"mModeNameStringId":"{20426d6f}"}`
  context (i.e. `jade`), also with legacy items; the other 45 simply have no authored
  recommendation. Example from `jade_garen.bin.json`: starting bundle
  `Items/771054`, `Items/772003`. **VERIFIED.**

The exclusivity is the tell: Riot authored KIWI_JADE build guidance onto exactly the
sixty modern champions that queue 2450 offers, and onto none of the legacy ones.

### Signal B: map 453 has a champion list, map 12 does not

`map453.bin.json` contains a `GameModeChampionList` record (`{95741a9d}`) with 60 hashed
entries. All 60 hashes resolve to `characters/jade_<alias>` under FNV-1a
(59 direct plus `characters/jade_wukong` for canonical alias `MonkeyKing`); the residual
set after matching is empty. **VERIFIED.**

`map12.bin.json` contains **no** `GameModeChampionList` at all. **VERIFIED.** The
Mayhem Classic-ish champion restriction lives only in the queue's
`viableChampionRoster`, which lists canonical ids (22 for Ashe), not Jade ids
(`https://raw.communitydragon.org/.../v1/queues.json`, queue 2450 vs queue 4300).

### Signal C: summoner spells (see section 5)

`KIWI_JADE` is listed on modern spell ids 1/4/6/7/13/14/21/32; `JADE` is listed on a
separate legacy id block 71..777. A mode running legacy characters would have no reason
to be wired to the modern spell namespace. **VERIFIED** from
`https://raw.communitydragon.org/.../v1/summoner-spells.json`.

### Signal D: the client hub data uses Jade ids only for Classic Rift

`v1/jade-champions.json` lists `championId: 60081, 60027, ...`, the Jade namespace, and
is Classic Rift content. Nothing equivalent exists for the Mayhem Classic-ish queue
(`v1/kiwi-hub.json` is an empty array, 2 bytes). **VERIFIED.**

### Signal E: the Jade legacy kits are real and separate, and confirm what "legacy" means

`https://raw.communitydragon.org/.../v1/champions/60022.json` returns
`alias: "Jade_Ashe"`, passive "Focus", Q "Frost Shot", W "Volley", E "Hawkshot",
R "Enchanted Crystal Arrow". So `Jade_Ashe` genuinely is the 2013 kit, and it is a
separate character record from `Ashe`. A kit swap of that size cannot be done by
property override; it requires the separate character, and nothing points map 12 at
those characters. **VERIFIED** (data) + **INFERRED** (the mechanism argument).

### The one thing that looks like counter-evidence, and why it is not

`map12.bin.json` loads the audio bank `MODE_Jade_SFX` (620 events, 232 of them
`Jade_*`) inside the `FeatureAudioDataProperties` record `{c0eb2d5e}`, which also loads
`MODE_Kiwi_SFX` and uses `Play_sfx_Env_Map453_Ambience_base`. That bank contains
legacy champion ability sounds (`Jade_EvelynnW`, `Jade_SivirW`, `Jade_KayleE`,
`Jade_TaricR`, `Jade_FiddlesticksWdrain`). **VERIFIED.**

It does not imply legacy kits on map 12, for two reasons. First, the same bank carries
legacy ITEM sounds (`Jade_BansheesVeil`) and legacy summoner spell sounds
(`SummonerClairvoyance`, `SummonerFortify`, `SummonerRally`, `SummonerRevive`), and map
12 does use the legacy item shop, so the bank has to be there regardless. Second, the
bank's champion coverage includes `Jade_Irelia` and `Jade_Galio`, champions that are
not in the sixty-champion roster and have no shipped Jade variant in
`champion-summary.json`, so bank membership is not a roster or runtime signal at all.
**VERIFIED** (contents) + **INFERRED** (interpretation).

### What this means for the coaching prompt

Ability text, ability scaling, passive data and base stats sourced from the wiki and
from canonical DDragon remain CORRECT for `KIWI_JADE`. They would be wrong for Classic
Rift (map 453), which we do not currently support at all.

---

## 2. Items

**Answer: both Jade modes use a legacy-only shop of about 150 items in the `77xxxx`
namespace. It is a replacement, not an overlay. Confidence: VERIFIED.**

The authoritative source is the mode's `itemLists` in the map bin, not any per-map flag.

**Classic Rift (map 453, `Maps/Shipping/Map453/Modes/JADE`)** has two lists:

- `{7d7e7c08}`: 150 items, all `771001..773521`, of which 142 are `inStore` with a
  non-zero price. This is the shop. **VERIFIED.**
- `{1ced71a9}`: 35 items, all internal, non-purchasable: `Recall`, `Disabled Recall`,
  `Turret Plating`, `Fortification`, `Tower Power-Up`, `Kalista's Black Spear`,
  `Scarecrow Effigy`, `Your Cut`, `Minion Dematerializer`, `Seraph's Embrace`,
  `Muramana`, the three `500 Silver Serpents` Gangplank upgrades, `Penetrating Bullets`.
  **VERIFIED.**

So yes: `77xxxx` is effectively the WHOLE shop on 453. There is no modern item you can
buy there.

**Mayhem Classic-ish (map 12, `Maps/Shipping/Map12/Modes/KIWI_JADE`)** has exactly one
list, `{af36a3b1}`: 156 entries, 150 of them `771001..773521`, 143 purchasable.
The six non-legacy entries are `2007 Disabled Recall`, `3330 Scarecrow Effigy`,
`3901/3902/3903` (Gangplank's Silver Serpent upgrades) and `223084 Heartsteel`
(granted by the KIWI_JADE-exclusive augment `FutureSightHeartsteel`, not shopped).
**VERIFIED.**

For contrast, plain ARAM on the same map uses `{413f2f94}` (193 items) plus four small
lists, and `KIWI` uses those same five plus `{3272f8d3}`. The lists are disjoint from
the KIWI_JADE one. **VERIFIED.**

### The two legacy shops are not identical

140 legacy ids are common. Ten are Classic-Rift-only and ten are Mayhem-Classic-ish-only.

- 453 only: `772003 Health Potion`, `772043 Vision Ward`, `772044 Sight Ward`,
  `772045 Ruby Sightstone`, `772049 Sightstone`, `772050 Explorer's Ward`,
  `773073 Stack of Sunfire Capes`, `773340 Yellow Trinket`, `773348 Red Trinket`,
  `771500 Penetrating Bullets` (internal). Wards and trinkets, as you would expect on a
  map with a fog of war economy. **VERIFIED.**
- KIWI_JADE only: `773512 Zz'Rot Portal`, `773513..773516` the four Hex Cores,
  `773517 Eggnog`, `773518 Bag of Tea`, `773519 Candy Corn`, `773521 Health Potion`,
  plus `223084 Heartsteel`. Most of these are augment payloads
  (`Upgrade_ZzRotPortal`, `HexCore`, `FutureSightHeartsteel`). **VERIFIED.**

Two legacy items appear in NEITHER shop list: `772139 AP Rune Replacer` and
`772140 AD Rune Replacer`, zero-cost items granting a flat rune-page's worth of stats.
No map bin references them. **VERIFIED** that they exist and are unreferenced;
see section 6 for what that might mean.

### Per-map flags cannot separate ARAM from Classic-ish, and are also just wrong

DDragon 16.15.1 `item.json` flags 416 items as available on map 453, of which only 151
are `77xxxx` and 265 are modern. `Infinity Edge` (3031) is flagged `"453": true` while
being absent from every map-453 mode item list. Legacy `771001 Boots of Speed` is
flagged true on both 12 and 453. **VERIFIED.** This is the same unreliability we already
recorded for the ARAM flags: the `maps` record is usable for "on no map" junk detection
and nothing else.

### What CAN separate them

- The Live Client `gameData.gameMode` string, which returns the literal `KIWI_JADE`
  (**VERIFIED** in our own log, and it matches the CDragon `map-assets.json` entry for
  map 12 whose `gameMode` is `KIWI_JADE`, `gameModeName` "ARAM").
- The LCU gameflow queue id: 2450 (PvP) or 3280 (custom). **VERIFIED** from `queues.json`.
- For the item pool itself there is no client-facing JSON that carries the mode item
  list. The practical proxy is the id namespace `771000..773999` (162 items total), which
  over-includes about 12 items for KIWI_JADE (wards, sightstones, trinkets, Health
  Potion 772003 which KIWI_JADE replaces with 773521). Recommending Sightstone in an
  ARAM-map mode would be the visible failure. The exact list is only obtainable from
  `map12.bin.json` -> `Maps/Shipping/Map12/Modes/KIWI_JADE.itemLists`. **VERIFIED.**

### Name collisions are a live hazard for our catalog

`items.json` has 868 items, 162 in the legacy namespace. 92 of the 161 distinct legacy
names collide exactly with a modern item name, and the stats differ. Examples:
`Banshee's Veil` is 3102 (105 AP, 40 MR, 3000g) modern versus 773102 (450 HP, 55 MR,
2750g) legacy; `Frozen Heart` is 3110 versus 773110 with different armor, mana and a
CDR versus ability-haste stat line. **VERIFIED.**

`src/lib/ai/item-catalog.ts:140` (`dedupeByName`) and `src/lib/ai/features/game-plan/index.ts:118`
both collapse items by name. If legacy items are ever admitted to the catalog without
namespacing the key, one of each colliding pair silently wins and the coach quotes the
wrong stat line. Note also that legacy item descriptions use a `<jadeUnique>` tag that
our `stripHtml` will erase along with the word boundary, same as other tags.

---

## 3. Augments

**Answer: `KIWI_JADE` has its own augment pool of 188, sharing 163 with Mayhem. Our
current ingest would miss 25 and wrongly offer 55. Confidence: VERIFIED.**

The client publishes the mapping directly at
`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/augment-lists.json`,
an array of `{modeName, augmentList}`:

- `CHERRY`: 44
- `KIWI`: 218
- `KIWI_JADE`: 188

**VERIFIED.** The counts match the game bins exactly: `AugmentData` record counts are
218 in `game/maps/modespecificdata/kiwi.bin.json` and 188 in
`game/maps/modespecificdata/kiwi_jade.bin.json`. So `kiwi_jade.bin.json` is the
KIWI_JADE analogue of the file `src/lib/data-ingest/sources/cdragon-kiwi-augments.ts`
already consumes, and the same three-endpoint join (cherry catalog + mode bin +
stringtable) would work unchanged against it. **VERIFIED** (files and shapes) +
**INFERRED** (that the existing resolver works on it without change; the bin has the
same `AugmentData` / `RootSpell` / `DescriptionTra` shape, but I did not run the code).

Set arithmetic: 163 shared, 55 KIWI-only, 25 KIWI_JADE-only. **VERIFIED.**

- The 25 KIWI_JADE exclusives are Jade-flavoured: `Upgrade_DeathFireGrasp`,
  `Upgrade_InnervatingLocket`, `Upgrade_ZzRotPortal`, `HexCore`, `SpiritOfTheJungleMain`,
  `DoransBiggestFan`, `TrainOfTheDead`, `ARAM_PoroKing`, `ARAM_Poro_Blast`,
  `ARAM_ClownCollege`, `BabyKitty`, `DipDiveDodge`, `DoOrDie`, `DontStopCleavin`,
  `DrinkUp`, `Dropybara_Active`, `FutureSightHeartsteel`, `GrandmasChiliOil`,
  `HasteMakesWaste`, `LaserHeal`, `SnowballRoulette`, `StabbyStabby`, `SummonersSafari`,
  `TrueEternity`, `ARAM_MissingPingAugment`.
- The 55 KIWI-only ones are heavily modern-item dependent and would be actively wrong to
  suggest: `ARAM_Upgrade_IE`, `ARAM_Upgrade_Collector`, `ARAM_Upgrade_Sheen`,
  `ARAM_Upgrade_ZH`, `ARAM_Upgrade_Immolate`, the four dragon souls, the whole
  `ARAM_Stats*` and `ARAM_Recursion` families, `HandOfBaron`, `ARAM_Homeguard`, etc.

The six augments in the live log all sit in the shared 163: `ARAM_YowchMyCoins`,
`ARAM_ItsCritical`, `SharkTempest`, `Twinfire`, `ARAM_Firebrand`, `CriticalMissile`.
**VERIFIED.** That is why nothing looked obviously broken in that session: we happened to
have those six already, via the Mayhem ingest. The 25 exclusives are the ones that would
have come back as unknown.

---

## 4. Runes

**Answer: Classic Rift uses a full legacy runes-and-masteries system with its own client
namespace. Mayhem Classic-ish appears to have no runes, same as Mayhem. Confidence:
VERIFIED for Classic Rift, INFERRED (moderate) for Mayhem Classic-ish.**

CDragon ships Jade-specific loadout files:

- `v1/jade-perks.json`: 50 entries, typed `kGlyph` / etc, e.g.
  `{"id":775289,"type":"kGlyph","statName":"Magic Resist","title":"Glyph of Magic Resist","amount":1.4}`.
  These are 2013 runes, not modern perks. **VERIFIED.**
- `v1/jade-rune-pages.json`: one page, `"League Classic Rune Page"`,
  `inventoryType: "InventoryTypes/JADE_RUNE_PAGE"`. **VERIFIED.**
- `v1/jade-mastery-display.json`: three trees, Offense / Defense / Utility. **VERIFIED.**
- `v1/jade-hub.json`: 200 mastery records (`masteryID`, `maxPoints`). **VERIFIED.**
- `map453.bin.json` references `/lol-game-data/assets/v1/jade-rune-pages.json` and the
  `JADE_RUNE_SLOT` inventory type. **VERIFIED.**

Careful with the obvious flag: `map-assets.json` reports
`properties.suppressRunesMasteriesPerks: true` for map 453 / `JADE`, for map 12 / `KIWI`,
and for map 12 / `KIWI_JADE`; it is `false` for map 12 / `ARAM`. **VERIFIED.** Since
Classic Rift demonstrably HAS runes and masteries, that flag means "suppress the MODERN
perk system", not "no runes". So the flag alone does not prove KIWI_JADE is runeless.

What supports "no runes in KIWI_JADE": no Jade rune page or mastery reference appears
anywhere in `map12.bin.json` (the only `Mastery`/`Perk` hits there are ARAM-inherited
`PerkReplacement` entries and the `SuppressRunesMasteriesPerks` constants), whereas
`map453.bin.json` wires the Jade rune inventory types explicitly. **VERIFIED** (the
absence) + **INFERRED** (the conclusion).

Implication for the recently shipped change that omits the runes line in Mayhem: the
same omission is correct for `KIWI_JADE` if that inference holds, and would be wrong for
Classic Rift, where the runes line should exist but would need an entirely different
data source (`jade-perks.json` plus `jade-mastery-display.json`, neither of which we
ingest).

---

## 5. Summoner spells

**Answer: two completely separate namespaces. Confidence: VERIFIED.**

From `v1/summoner-spells.json`, filtering on the `gameModes` array:

- `JADE`: 71 Cleanse, 73 Exhaust, 74 Flash, 75 Clairvoyance, 76 Ghost, 77 Heal,
  705 Fortify, 709 Rally, 711 Smite, 712 Teleport, 713 Clarity, 714 Ignite, 716 Surge,
  720 Promote, 721 Barrier, 777 Revive. Sixteen spells, six of which do not exist in
  modern League at all.
- `KIWI_JADE`: 1 Cleanse, 4 Flash, 6 Ghost, 7 Heal, 13 Clarity, 14 Ignite, 21 Barrier,
  32 Mark. The modern ids.
- `KIWI` for comparison: the same minus Clarity (13). `ARAM`: the KIWI_JADE set plus
  3 Exhaust.

So Mayhem Classic-ish adds Clarity relative to Mayhem and drops Exhaust relative to
ARAM. Any spell-recommendation or spell-import surface keyed on mode needs that third
list, and the LCU import path is only meaningful with these modern ids.

Anything else load-bearing that differs:

- **Legacy jungle and structures on 453.** `map453.bin.json` `MapCharacterList` records
  list `S3_Dragon`, `S3_Baron`, `S3_LizardElder`, `S3_AncientGolem`, `GreatWraith`,
  `Wraith`, `Wolf`, `GiantWolf`, `Golem`, `SmallGolem`, `S3Yonkey`, `YoungLizard`,
  `S3_PromoteMinion`, `Jade_Turret`, `Jade_Inhibitor`, `Jade_Nexus`, `Jade_VoidGate`.
  No scuttle, no Rift Herald, no elemental drakes. **VERIFIED.** Any objective or
  jungle-flavoured reasoning we emit would be wrong there. (It is also on the wrong side
  of the Riot map-action line anyway, so this is a "do not describe" note, not a feature.)
- **Map 12 gets a Jade skin, not a Jade map.** `v1/game-mode-mutators.json` lists
  `MapSkin_Map12_Jade` under MapId 12 with `MapNameOverride: "SR?"` (a Riot placeholder
  string). **VERIFIED.** It is still the Howling Abyss: one lane, no recall shop trips.
- **The Jade\_ champion entries corrupt our name-keyed champion map.** DDragon
  `champion.json` key `Jade_Ashe` has `name: "Ashe"`, `key: 60022`, `hp: 474`,
  `attackdamage: 49`, and sits at position 54 in `keys_unsorted` while canonical `Ashe`
  (`key: 22`, `hp: 610`, `ad: 59`) sits at position 10.
  `src/lib/data-ingest/sources/data-dragon.ts:36` does
  `champions.set(raw.name.toLowerCase(), ...)`, so the Jade entry wins for all sixty
  champions. **VERIFIED.** Given that `KIWI_JADE` uses modern stats, this overwrite has
  no upside anywhere in our supported modes: it is pure corruption of ARAM, Mayhem,
  Classic and Mayhem Classic-ish alike. (This is the previously recorded "Champion 22"
  bug; it is now confirmed to be unambiguously a bug, not a mode nuance.)

---

## 6. Unsettled, and what would settle it

1. **Legacy versus modern kit in KIWI_JADE, beyond doubt.** I consider this settled by
   five agreeing static signals, but the single observation that would close it: in a
   `KIWI_JADE` game, read the Live Client `https://127.0.0.1:2999/liveclientdata/activeplayer`
   and look at `abilities.Q.displayName` for a champion whose kit was reworked. On
   **Ryze**, modern reads `Overload` for Q and `Realm Warp` for R; legacy Jade reads
   `Overload` for Q but `Desperate Power` for R. On **Ashe**, modern passive is
   `Frost Shot` with Q `Ranger's Focus`; legacy Jade passive is `Focus` with Q
   `Frost Shot`. Either champion resolves it in one glance. My prediction: modern.
2. **Runes in KIWI_JADE.** Static data shows no Jade rune wiring on map 12, but absence
   is weaker than presence. Settle it by reading `activePlayer.fullRunes` in a
   `KIWI_JADE` game: an empty or all-default `generalRunes` array means no runes,
   matching Mayhem. Alternatively check whether champ select for queue 2450 offers a
   rune page at all.
3. **What the `AP/AD Rune Replacer` items (772139 / 772140) are for.** They exist in
   `items.json`, are `inStore` at price 0, grant a flat rune page's worth of stats, and
   are referenced by no map bin I fetched (map12, map453, kiwi, kiwi_jade, aram, jade).
   Plausible reading is that the server grants one to every player in a mode where
   legacy runes are unavailable, which would make them KIWI_JADE compensation stats.
   Settle it by reading the Live Client `playerlist` / `activePlayer` item slots in a
   `KIWI_JADE` game and looking for item id 772139 or 772140 in an inventory slot, or by
   comparing observed champion stats at level 1 against DDragon base stats.
4. **Whether the existing KIWI augment resolver runs clean against `kiwi_jade.bin.json`.**
   The file has the same record types and the same 188/218 correspondence to
   `augment-lists.json`, but I did not execute `resolveKiwiAugments` against it, so
   description token substitution and string-table resolution rates for the 25 exclusive
   augments are unmeasured. Settle it by pointing `KIWI_BIN_PATH` at
   `/game/maps/modespecificdata/kiwi_jade.bin.json` in a scratch run and counting empty
   descriptions.
5. **Classic Rift is entirely unmodelled by us.** Ability text, scaling, base stats,
   runes, masteries and items would all need Jade-namespace sources. Nothing here tells
   us whether Classic Rift is even in scope. No live observation needed, this is a
   product decision.

### Anomalies encountered

Recorded rather than worked around:

- `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions.json`
  (named in the brief) returns **HTTP 404**. The working endpoints are
  `champion-summary.json` (234 entries, 60 with id >= 60000, max id 60117) and
  `champions/{id}.json` per champion.
- The Jade variant of Wukong is `jade_wukong` / alias `Jade_Wukong`, while the canonical
  alias is `MonkeyKing`. Anything that derives the Jade name by prefixing the canonical
  alias will 404 on exactly this one champion. Hit during the bulk fetch.
- `v1/kiwi-hub.json` is 2 bytes (an empty array) while `v1/jade-hub.json` is 69 KB. Not a
  fetch failure, the file is genuinely empty upstream.
- `MODE_Jade_SFX` contains legacy ability audio for `Jade_Irelia` and `Jade_Galio`,
  champions that have no shipped Jade variant in `champion-summary.json` and are not in
  any Jade roster. Riot authored more legacy content than they exposed.
- `jade.bin.json` (28 KB) is not mode gameplay data at all: it is entirely role-bound
  quest narrative barks (`NarrativeBark_RoleBoundQuest_*`) plus a
  `CharacterQuestListConfig`. Classic Rift apparently ships a role quest system. Not
  investigated further.
