# Technical Reference

Learnings and patterns discovered during implementation. Reference this when working on related tasks.

## Riot Live Client Data API (localhost:2999)

### Connection states

| State           | Behavior                                   |
| --------------- | ------------------------------------------ |
| No game running | Connection refused / timeout               |
| Loading screen  | Server is up, returns 404 on all endpoints |
| In-game         | Returns 200 with full JSON                 |

The API uses a self-signed HTTPS certificate. The Tauri webview can't fetch it directly — we proxy through a Rust command (`fetch_riot_api`) that uses `reqwest` with `danger_accept_invalid_certs`.

### What the API exposes

**Active player (full detail):**

- Champion name (resolved via `riotIdGameName` match in `allPlayers` — the `activePlayer` block sometimes omits `championName`)
- Level, current gold
- Full rune page: keystone, all 6 general runes, primary/secondary trees
- Complete stat block: AD, AP, armor, MR, attack speed, ability haste, crit chance/damage, lifesteal, omnivamp, spell vamp, lethality (physical + magic), armor/magic pen (flat + percent), heal/shield power, HP/mana regen, resource type/value/max, tenacity, move speed, max/current health
- All 5 abilities with names, IDs, and current level

**All players (limited detail):**

- Champion name, team (ORDER/CHAOS), level
- KDA (kills/deaths/assists)
- Items (ID, display name, slot, count)
- Summoner spells
- Keystone rune + primary/secondary tree IDs
- `riotIdGameName` + `riotIdTagLine`
- `isBot`, `respawnTimer`
- `position` (populated in SR, empty in ARAM)

**Game data:**

- `gameMode` (ARAM, CLASSIC, etc.)
- `gameTime` (float seconds)
- `mapName`, `mapNumber`, `mapTerrain`

**Not exposed:**

- Augments (any mode) — requires voice/manual input. In ARAM Mayhem, augment selection happens at levels 1, 7, 11, and 15 (4 total per game), but only after the player returns to the Nexus at that level. The API exposes player level but not whether they're at the Nexus or have an augment offer pending.
- Some augments auto-select a follow-up (e.g., Transmute: Chaos grants two random augments instead of one). This can happen once per game, meaning a player can end up with 5 augments total (4 chosen + 1 granted). The API doesn't expose these auto-selections, so the app needs a way to record the granted augment. The UI should distinguish between "chosen" slots (4 max) and a "granted" slot that appears as a result of choosing certain augments. With voice input, the user can report all augments received in one utterance.
- Enemy gold (only active player's gold)
- Ability cooldowns (Riot policy)
- Detailed stats for other players
- Minimap positions

## Data Sources

### DDragon (champions, items, runes)

- **Versions:** `https://ddragon.leagueoflegends.com/api/versions.json` — array of version strings, first is latest
- **Champions:** `https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json` — keyed by champion ID string
- **Items:** `https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/item.json` — keyed by item ID string
- **Runes:** `https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/runesReforged.json` — array of rune trees

**Item ID ranges encode game mode:**

| Range         | Mode                       |
| ------------- | -------------------------- |
| 1000-8999     | Standard (Summoner's Rift) |
| 9000-9999     | Swarm                      |
| 220000-229999 | Arena variants             |
| 320000-329999 | ARAM variants              |
| 660000+       | Other mode variants        |

Arena/ARAM variant items are **overrides on standard items**, not separate items. Same item, different gold cost or stats for that mode. The Mode Module should start with standard items and overlay the mode-specific variant data.

**Item name quirks:** Some items (Gangplank upgrades) have HTML in the `name` field like `<rarityLegendary>Fire at Will</rarityLegendary><br><subtitleLeft>...`. We strip HTML and take only the text before `<br>`.

**Non-purchasable zero-gold items** are system internals (turret buffs, quest trackers, structure bounties). Filtered out during ingest. Purchasable zero-gold items (wards, trinkets) are kept.

### DDragon (champion abilities)

- **Per-champion full data:** `https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion/{ChampionId}.json`
- **No bulk endpoint** — requires one request per champion (~170 total). Fetch lazily, not upfront.
- The `description` field on spells is clean plain text (no markup). The `tooltip` field has `{{ variable }}` placeholders and custom XML tags — not statically resolvable.
- Scaling ratios and base damage numbers are NOT available from DDragon. The `vars` and `effect` arrays are empty/zeros on modern champions. For the recommendation engine, the clean `description` text is what the LLM reasons about.
- Useful numeric data per spell: `cooldown[]` (per rank), `cost[]` (per rank), `range[]` (per rank), `maxrank`.
- Passive has only `name` and `description` — no cooldown or scaling data.

### League Wiki Lua Module (augments)

- **Mayhem augments:** `https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw`
- **Arena augments:** `https://wiki.leagueoflegends.com/en-us/Module:ArenaAugmentData/data?action=raw`
- **Champion data (with ARAM overrides):** `https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data?action=raw`
- **Regular ARAM augments:** Do not exist. Augments are Mayhem-specific within ARAM, and Arena-specific. No wiki module exists.

**Arena augments** have the same Lua structure as Mayhem augments except no `set` field (Arena has no augment sets). ~275 total entries. Three system/fallback augments ("404 Augment Not Found", "Augment 405", "Null") are filtered out — they're granted when game effects fail, never offered as player choices.

**Multi-set augments:** Some Mayhem augments belong to two sets (e.g., Self Destruct → Dive Bomb + Fully Automated). The `set` field in the wiki data uses `<br>` to separate multiple sets, each with the full `[[File:...]] [[Page|SetName]]` markup. Split on `<br>` before stripping markup.

**Augment set bonuses:** No Lua data module exists. The 9 set bonus definitions are only on the wiki article page `ARAM: Mayhem/Augment Sets`. Hardcoded as structured data since there are only 9 and they rarely change.

**Cross-mode augment overlap:** Many augments exist in both Mayhem and Arena with the same name. Mayhem data is richer (has set info). Stored as separate entries with `arena:`-prefixed keys for duplicates to avoid data loss.

**Parsing notes:**

- Use `luaparse` (not regex). Augment descriptions contain `}}` from wiki templates that break regex-based entry matching.
- The raw Lua has a `-- <pre>` wrapper that must be stripped before parsing.
- `ChampionData` contains unicode right quotes (U+2019) and em dashes that luaparse chokes on — replace with ASCII equivalents before parsing.
- Wiki markup in descriptions uses `{{as|...}}`, `{{tip|key|display}}`, `{{pp|...}}`, `[[[File:...]]`, `'''bold'''`, `''italic''`. All stripped during ingest.

### Community Dragon (augment IDs/icons)

- **Cherry augments:** `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`
- Contains augments from ALL modes mixed together (532 total). Only 4 fields per entry: `id`, `nameTRA`, `augmentSmallIconPath`, `rarity`. No enabled/disabled flag — cannot distinguish real augments from test/internal entries by metadata alone.
- CDragon-only augments (not matched to any wiki source) are **skipped** during merge. They have no descriptions and include junk entries like "404 Augment Not Found" (which IS real in Arena, but sourced from the wiki instead).

**Icon paths encode game mode:**

| Path pattern                | Mode   |
| --------------------------- | ------ |
| `UX/Kiwi/`                  | Mayhem |
| `UX/Cherry/` (without Kiwi) | Arena  |
| `UX/Strawberry/`            | Swarm  |

**Duplicate entries:** Same augment name can appear with different IDs (e.g., ADAPt as both 205 and 1205). The 1000+ range appears to be Mayhem-specific IDs, lower range is Arena. When merging, prefer the entry whose mode matches the wiki source.

**Name matching quirks:** CDragon names can differ slightly from wiki names — e.g., "Get Excited!" vs "Get Excited" (punctuation), "Sneakerhead" vs "Quest: Sneakerhead" (prefix). We normalize by stripping punctuation for matching.

## ARAM Balance Overrides

Embedded in the ChampionData Lua module as `["aram"]` tables inside each champion's `["stats"]` block. 160 out of 174 champions have overrides.

**Fields (all multipliers except ability_haste):**

| Lua key           | Our field        | Type       | Example                    |
| ----------------- | ---------------- | ---------- | -------------------------- |
| `dmg_dealt`       | `dmgDealt`       | multiplier | 1.05 = +5% damage dealt    |
| `dmg_taken`       | `dmgTaken`       | multiplier | 0.95 = -5% damage taken    |
| `healing`         | `healing`        | multiplier | 0.8 = -20% healing         |
| `shielding`       | `shielding`      | multiplier | 0.9 = -10% shielding       |
| `tenacity`        | `tenacity`       | multiplier | 1.2 = +20% tenacity        |
| `energyregen_mod` | `energyRegenMod` | multiplier | 1.2 = +20% energy regen    |
| `total_as`        | `totalAs`        | multiplier | 1.025 = +2.5% attack speed |
| `ability_haste`   | `abilityHaste`   | flat value | 10 = +10 ability haste     |

`dmg_dealt` and `dmg_taken` are always present when the `aram` block exists. Other fields are optional and omitted when not modified.

Many champions have `dmg_dealt: 1, dmg_taken: 1` (no actual change) — check for non-neutral values before displaying.
