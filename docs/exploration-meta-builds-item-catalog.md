# Exploration: Meta Builds & Item Catalog in Coaching Prompt (#95)

## Problem / Opportunity

The coaching LLM has no item data in its prompt. All item recommendations come from training data, which may be outdated or inaccurate for the current patch. The model doesn't know what items exist in the current game, what they cost, what stats they give, or how they build from components. It's guessing.

We need to give the LLM an accurate, current-patch item pool to reason with. To make that pool more useful, we can weight it toward items that are actually performing well on the player's champion right now — not by prescribing builds, but by using community match data to identify which items are worth highlighting. The LLM still makes all the decisions based on game state; it just starts with better information.

## Core Requirements

### Must-Have

1. **Meta build data collection script** — a local TypeScript script that fetches high-elo match data from the Riot Match-v5 API, computes top builds and rune pages per champion, and outputs JSON files checked into the repo. Run manually once per patch.

2. **Meta-derived item list in the coaching prompt** — at runtime, look up the player's champion in the meta build data, extract the union of all items across the top builds, resolve each item ID against the full item catalog (stats, costs, build paths), and include that curated list as the primary tier in the prompt.

3. **Broader item catalog as fallback tier** — include remaining items for the current game mode (filtered by mode) with lighter detail (stats + cost) so the LLM can recommend situational deviations when the game state warrants it.

4. **Reactive pre-computation** — assemble the item context as soon as the champion is known during champ select. Recompute if the champion changes. Context is ready before the game starts with no perceptible delay.

### Nice-to-Have

- Rune data is collected alongside meta builds but only used in a future issue focused on champ select / rune coaching.
- UI display of meta builds (not in scope — this issue is prompt-only).

## Key Decisions Made

### Data Source: Riot Match-v5 API (Self-Aggregated)

**Why:** Client-only architecture is non-negotiable. No backend, no third-party data licenses. The Riot API is free, legally bulletproof, and provides authoritative match data.

**Alternatives considered and rejected:**

- Community API providers (op.gg, u.gg, lolalytics, METAsrc) — none have public APIs licensed for use in distributed apps. Would require business relationships.
- Overwolf data services — Overwolf provides live game events (GEP) but no aggregated meta/build data.
- LLM training data alone — insufficient. The model's item knowledge is stale and doesn't reflect current patch meta. Confirmed by observing that current game plans don't match established builds.

### Two-Tier Prompt Structure

The prompt presents items in two tiers to give the LLM a strong prior without limiting its options:

**Tier 1 — Meta-derived items (~15-25 per champion):**
Extracted as the union of all items across the top 3-5 builds for the player's champion. Presented with full detail: name, description, stats, cost, build path. Framed as "items that are winning on your champion right now."

**Tier 2 — Remaining mode-filtered items (~40-60):**
All other purchasable items valid for the current game mode, minus Tier 1 items. Presented with lighter detail: name, key stats, total cost. Framed as "other items available this game mode that you may recommend if the situation calls for it."

**Why two tiers:** A flat list of 60-80 items dilutes the signal from proven meta items. The hierarchy gives the LLM a strong default (meta items) while preserving the ability to recommend situational deviations (Zhonya's against a fed assassin, Grievous Wounds against heavy healing, etc.). This is the core value proposition — start from what's proven, deviate when the game warrants it.

### Individual Builds Preserved in Data

The JSON files store the individual top builds (items + runes + win rate + pick rate + sample size), not just the derived item union. This allows:

- Future UI features showing popular builds
- More sophisticated prompt strategies later
- The item union derivation happens at runtime as a lightweight transform

### Runes Collected but Deferred

The meta build script collects rune page data alongside item builds. This data is stored in the JSON output but is NOT used in the coaching prompt for this issue. A separate future issue will use it for champ select / pre-game rune coaching.

### Prompt Placement

Item catalog sections are inserted after the champion profile and before the match roster. The model learns who it's coaching, then what items are relevant, then sees the enemy team to reason against.

### Pre-computation Trigger

Item context is assembled reactively when the champion is known during champ select (using the champion name from `useGameLifecycle`, implemented in issue #94). If the champion changes (swaps, trades, re-picks), the context recomputes. This is cheap — it's filtering and lookups against data already in memory.

## Meta Build Data Collection Script

### Overview

A TypeScript script in `scripts/` that fetches match data from the Riot Match-v5 API and produces per-queue-type JSON files with top builds per champion.

### Script Entry

- Location: `scripts/fetch-meta-builds.ts`
- Package.json entry: `pnpm fetch-meta`
- API key: read from `.env` file (`RIOT_API_KEY`)

### Queue Types Collected

| Queue           | Queue ID | Output File                         |
| --------------- | -------- | ----------------------------------- |
| Ranked Solo/Duo | 420      | `data/meta-builds/ranked-solo.json` |
| ARAM            | 450      | `data/meta-builds/aram.json`        |
| Arena           | 1700     | `data/meta-builds/arena.json`       |

**ARAM: Mayhem is NOT collected.** See "Mayhem Data Limitation" below.

### Mayhem Data Limitation

ARAM: Mayhem match data is not accessible through the Riot public API. This was confirmed by Riot representatives in [developer-relations issue #1109](https://github.com/RiotGames/developer-relations/issues/1109):

- Direct queries to Match-v5 with a Mayhem match ID return **403 Forbidden**
- Filtering `matches/by-puuid` by queue ID 2400 returns an empty list for everyone
- Recent Mayhem games played by real users appear in the API as queue 450 ("ARAM") with augment data stripped from the response — there is no way to distinguish them from standard ARAM games
- This policy also applies to other rotating/limited modes like Brawl and Doom Bots — Riot has stated they do not intend to expose data for these modes through the public API

**Decision:** Use ARAM meta build data as the baseline for Mayhem coaching. This matches how players approach Mayhem in practice — start from a proven ARAM build, then adapt item choices based on augment synergies during the game. The LLM reasons about augment-specific tweaks using its general item knowledge; the ARAM item pool gives it a current-patch-accurate starting point.

The coaching prompt should load `aram.json` for both standard ARAM and Mayhem games. Mode-specific behavior (e.g., augment-aware reasoning) is handled elsewhere in the prompt, not by having separate meta build data.

### Data Collection Strategy

- **Region:** NA only (expandable later)
- **Rank tier:** Challenger/Grandmaster/Master/Diamond I for ranked-solo. Same high-elo pool used as snowball seeds for ARAM and Arena.
- **Sample target:** Enough matches to get statistically meaningful data for all 172 champions, including rare picks. Targeting several hundred games minimum per champion.
- **Approach for ranked-solo:** Fetch high-elo player list → get each player's match IDs for the queue → fetch match details → bucket by champion.
- **Approach for casual queues (ARAM, Arena):** Interleaved snowball. Take a seed PUUID, fetch their match IDs, fetch details for each new match, add all 10 participants to the queue for future processing. This snowballs: each match reveals 9 new players who actually play the mode, accelerating discovery beyond the initial seed list.
- **Priority seed (optional):** A Riot ID can be provided via `RIOT_SEED_ID` in `.env` (format: `gameName#tagLine`). If set, the script resolves it to a PUUID via Account-v1 and prepends it to the snowball queue. Useful if the primary user plays the target modes and their match history makes a good starting point.
- **Estimated runtime:** 30-60 minutes per queue type with a development API key (20 req/sec).
- **When to run:** Manually after each patch (every ~2 weeks), once enough match data exists (1-2 days after patch).

### Resumability (Critical Requirement)

The script MUST be fully resumable and idempotent. The core principle: **never re-fetch data you already have, and persist progress incrementally.**

Run it, stop it, run it again — it picks up where it left off. No flags, no cleanup, no "start over" mode. If it was one API call away from finishing when it stopped, restarting makes that one call and completes.

Aggregation (computing top builds from raw match data) is a separate step that reads from persisted data and regenerates the output JSON files. It can be re-run at any time without re-fetching.

### Output Data Shape

The exact output shape needs to be designed during implementation based on what the Match-v5 API actually returns per participant. The shape should be driven by the real data — not guessed in advance.

What we know we need per champion per queue type:

- Top 3-5 distinct builds (item sets + rune pages)
- Win rate and pick rate per build
- Sample size (total games for that champion)
- Metadata: patch version, region, collection timestamp

What needs investigation during implementation:

- Exact structure of rune data from the API (trees, shards, keystones)
- How rune data differs across game modes
- How to best represent the build to support both the derived item pool (this issue) and future rune coaching

### Riot API Rate Limits

- **Development key:** 20 requests per second, 100 requests per 2 minutes. Key expires every 24 hours (must re-auth at developer.riotgames.com).
- **Production key:** ~500 requests per 10 seconds for match endpoints. Does not expire. Requires application review.
- **Cost:** The Riot API is completely free. No usage fees.
- The script must respect rate limits with appropriate throttling and backoff.

### Match-v5 API Data Available Per Match

Each match detail includes per participant:

- Champion, win/loss, items (6 + trinket), runes (full page), summoner spells
- KDA, damage dealt (physical/magic/true), damage taken, gold earned
- CS, vision score, level, position/role

The script primarily uses: champion, items, runes, win/loss, game mode. The rest is available for future use.

## Existing Item Data (Already in App)

The full item catalog is already loaded from Data Dragon at app startup. No new data ingestion needed for items.

### Item Type (from `src/lib/data-ingest/types.ts`)

```typescript
interface Item {
  id: number;
  name: string;
  description: string; // Full HTML-stripped description
  plaintext: string; // One-line summary (only 25% populated — unreliable)
  gold: ItemGold; // base, total, sell, purchasable
  tags: string[]; // Category tags: "Armor", "SpellDamage", "AttackSpeed", etc.
  stats: Record<string, number>; // Stat values: FlatMagicDamageMod, FlatArmorMod, etc.
  from?: number[]; // Component item IDs (build path)
  into?: number[]; // Items this builds into
  image: string; // CDN URL
  mode: ItemMode; // "standard" | "arena" | "aram" | "swarm" | "other"
}
```

### Item Count

~250-300 purchasable items after filtering out system/placeholder entries. Mode filtering reduces this to 60-80 per game mode.

### Champion Tags (for context)

Champions have two tags from: Mage, Assassin, Marksman, Fighter, Tank, Support. These inform which items are relevant but are NOT used for hard filtering — the mode filter + meta derivation handles curation.

## Prompt Structure

### Format for Tier 1 (Meta-Derived Items)

```
== Items proven on [Champion Name] this patch ==
[Item Name] — [Full description]. [Stats breakdown]. Cost: [total]g (builds from: [components]).
...
```

### Format for Tier 2 (Remaining Mode Items)

```
== Other available items ==
[Item Name] — [Key stat summary, e.g., "80 AP, 300 HP, 20 AH"]. [total]g.
...
```

### Prompt Section Ordering

1. Coaching persona & rules (existing)
2. Conversation format (existing)
3. Proactive awareness (existing)
4. Augment selection rules (existing, mode-dependent)
5. Game mode name (existing)
6. Player champion profile & abilities (existing)
7. **Items proven on champion this patch (NEW — Tier 1)**
8. **Other available items (NEW — Tier 2)**
9. Runes (existing)
10. Match roster (existing)

## Compliance Constraints (Riot & Overwolf)

### Allowed

- Item win rates for standard items (SR ranked, ARAM standard items)
- Pick rates for all items and augments in all modes
- Feeding item data and meta context to an LLM for coaching recommendations
- Presenting multiple build options with reasoning

### Prohibited

- **Augment win rates** — cannot display win rates for augments in Arena or Mayhem (pick rates are fine)
- **Arena item win rates** — cannot display win rates for Arena-specific items
- **Tactical map actions** — "go gank top" or "take dragon now" (not relevant to this feature but noted for completeness)

### Implications for This Feature

- The meta build JSON files store win rates internally (needed for ranking builds). This is fine — the data itself is not user-facing.
- If a future issue adds UI to display meta builds, win rates must be **suppressed for Arena and Mayhem modes**. Pick rates and "popularity" framing can be used instead.
- The coaching prompt uses the item data for reasoning, not for displaying statistics to the user. The LLM says "consider building X because it synergizes with your comp," not "X has a 54% win rate." This is squarely in the allowed zone.

## Open Questions

- **Build clustering:** How do we determine that two item sets are "the same build"? Exact 6-item match is too strict (order and one-item variations would create many near-duplicates). Need a clustering or similarity approach during aggregation. To be resolved during implementation.
- **Rotating game modes:** Mayhem and Arena are not always active. The script should handle gracefully when no recent data exists for a queue type (skip or retain last available data).
- **Patch transition:** When a new patch drops and items change, the old meta data becomes stale. The script should detect the current patch and tag output accordingly. Stale data is better than no data for the first day or two of a new patch.
- **Boot items:** Boots are part of builds but have their own slot. Should the prompt treat them separately ("recommended boots") or just include them in the item pool? To be resolved during implementation.
