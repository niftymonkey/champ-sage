# Augment Detection Research

> Issue #59: Investigate programmatic augment offer detection

## Summary

Riot's official APIs (Live Client Data API, LCU WebSocket, LCU REST, Match-v5) do not expose augment offer or selection events during gameplay. The only sanctioned programmatic mechanism for detecting augments in real-time is **Overwolf's Game Events Provider (GEP)**, which hooks into the game process via a Vanguard-whitelisted DLL.

This research led to the decision to migrate from Tauri to Overwolf Electron (`@overwolf/ow-electron`) — see `docs/ow-electron-migration-plan.md`.

## What was investigated

### 1. Riot Live Client Data API (localhost:2999)

The complete endpoint list was audited against community documentation (stirante, MingweiSamuel's OpenAPI schema):

| Endpoint                                | Augment data?              |
| --------------------------------------- | -------------------------- |
| `/liveclientdata/allgamedata`           | No                         |
| `/liveclientdata/activeplayer`          | No                         |
| `/liveclientdata/activeplayerabilities` | No                         |
| `/liveclientdata/activeplayerrunes`     | No                         |
| `/liveclientdata/playerlist`            | No                         |
| `/liveclientdata/playeritems`           | No                         |
| `/liveclientdata/playerscores`          | No                         |
| `/liveclientdata/playersummonerspells`  | No                         |
| `/liveclientdata/eventdata`             | No (kills/objectives only) |
| `/liveclientdata/gamestats`             | No                         |

No augment-related data appears in any endpoint. The schema has not been updated for Arena or Mayhem augment features.

### 2. LCU WebSocket (WAMP 1.0)

The LCU WebSocket was monitored during a full ARAM Mayhem game session using our `scripts/lcu-monitor.ts` tool. The monitor subscribes to `OnJsonApiEvent` (the broadest possible subscription — all JSON API events).

**Finding:** No augment-related events fire during gameplay. The only "augment" endpoints in the LCU are cosmetic TFT augment-pillar skins:

- `GET /lol-cosmetics/v1/inventories/{setName}/augment-pillars`
- `PUT /lol-cosmetics/v1/selection/tft-augment-pillar`
- `DELETE /lol-cosmetics/v1/selection/tft-augment-pillar`

**Why:** The LCU is the League Client (lobby/launcher) process, which is separate from the game process. During gameplay (InProgress phase), the LCU provides phase transitions and client-level events, but the actual in-game state (including augment selection screens) happens inside the game process, which the LCU cannot see.

### 3. Riot Match-v5 API (post-game)

- After a game ends, Match-v5 includes `PlayerAugment1` through `PlayerAugment4` fields with augment IDs
- However, **Mayhem matches return 403** (confirmed via Riot developer-relations issue #1109) — Riot treats Mayhem match data as private
- Augment metadata (names, descriptions, icons) is available from CommunityDragon: `https://raw.communitydragon.org/{version}/cdragon/arena/en_us.json`
- This provides historical augment data for analysis but not real-time detection

### 4. SkinSpotlights Live Events API

An undocumented API that was enabled via `game.cfg`, supporting events like `OnKill`, `OnDamage`, etc. **Removed as of patch 14.1.** Only worked in spectator/replay mode, never in live gameplay. Never had augment events even when it worked.

### 5. Overwolf Game Events Provider (GEP)

**This is the key finding.** Overwolf GEP exposes augment events for both ARAM Mayhem and Arena modes since GEP version 299.0.

#### Available events

**`augments`** (category: `me`) — List of available augments offered to the player (the 3 choices):

```json
{
  "augment_1": { "name": "TFT8_Augment_DefenderTrait" },
  "augment_2": { "name": "TFT7_Augment_PandorasBench" },
  "augment_3": { "name": "TFT6_Augment_SecondWind1" }
}
```

**`picked_augment`** (category: `me`) — Which augment the player selected, with slot tracking:

```json
{
  "slot_1": { "name": "TFT9_Augment_CyberneticBulk3" },
  "slot_2": { "name": "TFT9_Augment_SettTheBoss" },
  "slot_3": { "name": "" }
}
```

#### How GEP works

GEP uses DLLs (`gep_lolarena.dll`, `gep_lolarenaext.dll`) that run alongside the game process. These are whitelisted by Vanguard through a partnership between Overwolf and Riot. This is NOT a public API — you must build an Overwolf app to access the data.

#### API usage in ow-electron

```typescript
// Declare needed packages in package.json
{ "overwolf": { "packages": ["gep", "overlay"] } }

// Subscribe to augment features
app.overwolf.packages.gep.setRequiredFeatures(['augments']);

// Listen for augment offers
app.overwolf.packages.gep.on('new-info-update', (e, gameId, ...args) => {
  // args contains augment offer/pick data
});

// Listen for augment selection events
app.overwolf.packages.gep.on('new-game-event', (e, gameId, ...args) => {
  // args contains game event data
});
```

#### GEP changelog (augment-related entries)

Multiple fixes and improvements have been made to augment detection:

- "Added support for multiple augment selection"
- "Split between augments and items, created `item_select` info update"
- Multiple fixes to `picked_augment` event accuracy (Dec 2023+)
- Multiple fixes to `augment` event timing and data completeness

### 6. Augment name mapping

GEP uses internal augment names (e.g., `TFT8_Augment_DefenderTrait`) that need to be mapped to our augment data model (display names, descriptions, tiers, set membership). This mapping will use CommunityDragon's `cherry-augments.json` which contains both internal IDs/names and display names.

## How other tools detect augments

### Blitz.gg

- **Platform:** Overwolf app
- **Augment overlays:** Explicit ARAM Mayhem and Arena augment overlays that show tier ratings during augment selection
- **Mechanism:** Overwolf GEP (confirmed — they state they do not read or write memory)

### OP.GG Desktop

- **Platform:** Overwolf app
- **Has:** "Augment Tier" overlay showing tier of augments that fit the current champion
- **Mechanism:** Overwolf GEP

### your.gg

- **Platform:** Standalone desktop app (not Overwolf)
- **Behavior observed:** 1-2 second delay before overlay appears, inconsistent coverage (overlay on 1 of 3 stat anvils but not others)
- **Mechanism:** Unknown. The delay and inconsistency pattern is more consistent with OCR/screen capture than API-based detection, but could also be Overwolf GEP with latency. Their site says the app "connects to your League of Legends Client" (LCU language).
- **Acquired by Gen.G** (May 2024) — may have elevated Riot API access through partnership

### TFT Augment Overlay (open source)

- **Repository:** `github.com/arunthiruma588/tft-augment-overlay`
- **Mechanism:** OCR via pytesseract + python-image-search + pillow
- **Limitations:** Only supports 1920x1080, resolution-dependent, fragile
- **Confirms:** No standard API exists for TFT augment detection either

## Approaches evaluated for Champ Sage

| Approach                  | Detects specific augments?              | Reliability                                   | Effort                                | ToS risk                                           |
| ------------------------- | --------------------------------------- | --------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| **Overwolf GEP**          | Yes (exact names)                       | High                                          | High (requires ow-electron migration) | None (sanctioned)                                  |
| **Screen capture + OCR**  | Yes (if recognition works)              | Medium (resolution-dependent, can miss cards) | Medium                                | Low (gray area)                                    |
| **Level-based heuristic** | No (only knows WHEN to expect an offer) | Low                                           | Low (already built)                   | None                                               |
| **Memory reading**        | Yes                                     | High                                          | Medium                                | **Prohibited** (blocked by Vanguard, violates ToS) |

**Decision:** Migrate to ow-electron for GEP access. OCR reserved as backup plan. See `docs/ow-electron-migration-plan.md` for the migration plan.

## Riot policy compliance

### What's allowed

- Build recommendations, item suggestions, champion select assistance
- Overlays that "highlight decisions and give multiple choices to help players make good decisions"
- Apps that pull data through official APIs
- Premium app versions (if a free version exists)
- Products that "increase, not decrease, the diversity of game decisions"

### What's prohibited

- Tracking enemy summoner spell cooldowns or ability cooldowns
- Ultimate timers (explicitly banned March 2025)
- Notifications that "dictate player action" (e.g., "go gank top lane")
- Power spike alerts (e.g., "X champion has hit level 6")
- De-anonymizing players in Ranked Solo/Duo champ select
- Custom ranking systems, MMR/ELO calculators
- In-game overlay advertisements (banned May 2025)
- Overlays that mimic Riot's UI
- **ALL Brawl-related data** — explicitly prohibited for third-party use
- Memory reading (blocked by Vanguard)
- **Augment win rate display** is specifically prohibited: "Products cannot display win rates for Augments or Arena Mode items." However, popularity/pick rate is allowed.

### What Champ Sage does (contextual reasoning, not win rates)

Champ Sage provides contextual coaching recommendations ("given your build and the enemy team, this augment synergizes best") rather than statistical win rates ("this augment has a 58% win rate"). This aligns with Riot's allowance of tools that "highlight decisions and give multiple choices" without "dictating player action."

### Vanguard anti-cheat

- Kernel-level anti-cheat (Ring 0), live on LoL since April 2024
- **No allowlist exists** — no exceptions for any developer
- Memory reading is blocked; apps must adapt or be blocked
- LCU API, Live Client Data API, and Overwolf GEP continue to work
- Overwolf's GEP DLL is not "whitelisted" per se — Riot says there is no allowlist — but it does work alongside Vanguard, likely due to how GEP hooks into the game process

### Registration requirement

All products serving League players must be registered on the Riot Developer Portal, regardless of whether they use official APIs. This applies to Champ Sage. URL: `https://developer.riotgames.com/policies/general`

### Key policy sources

- General policies: `https://developer.riotgames.com/policies/general` (updated March 2025)
- Vanguard FAQ: `https://www.riotgames.com/en/DevRel/vanguard-faq`
- Vanguard DevRel: `https://support-developer.riotgames.com/hc/en-us/articles/28021427366163-Vanguard`
- API Terms: `https://support-developer.riotgames.com/hc/en-us/articles/22698917218323-API-Terms-and-Conditions`
- Overwolf compliance: `https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games/`

## Overwolf Electron (ow-electron) technical details

### What it is

A closed-source fork of Electron.js (`@overwolf/ow-electron`) that adds Overwolf's proprietary APIs. Drop-in replacement for the `electron` npm package. Current version: 39.6.0 (March 2026).

### Packages

- `@overwolf/ow-electron` — replaces `electron`
- `@overwolf/ow-electron-builder` — replaces `electron-builder`
- `@overwolf/ow-electron-packages-types` — TypeScript types
- `@overwolf/electron-is-overwolf` — runtime detection for dual-build support

### Available Overwolf API modules

| Module     | Purpose                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `overlay`  | In-game overlay windows (standard mode for MOBAs, exclusive mode for FPS) |
| `gep`      | Game Events Provider — real-time game data                                |
| `recorder` | Audio/video recording (beta)                                              |
| `crn`      | Content Recommendation Notifications                                      |
| `utility`  | Game launch/exit detection, installed games scanning                      |

### Overlay for League of Legends

League uses **standard mode** — the mouse cursor is visible during gameplay, so overlay windows are interactive without mode switching. Overlay windows support:

- `passThrough` — display-only, clicks pass through to the game
- `noPassThrough` — interactive, clicks handled by the overlay
- `passThroughAndNotify` — clicks pass through AND the overlay is notified
- DPI awareness, game-bounds constraint, dragging

### Global hotkeys

`overlay.hotkeys` API replaces `WH_KEYBOARD_LL`. Works during gameplay:

- `register(hotKey, callback)` — callback receives `(hotKey, state)` where state is `"pressed"` or `"released"`
- Supports modifiers (ctrl, alt, shift, meta, custom)
- `passthrough` option: if `true`, key reaches both overlay and game

### Audio capture

`getUserMedia` works in Electron with `backgroundThrottling: false` on the BrowserWindow. The audio stream continues capturing when the window is unfocused or minimized. For timer-sensitive processing, use AudioWorklet (runs on a separate thread, not subject to background throttling).

### Dual-build support

`@overwolf/electron-is-overwolf` detects the runtime at startup. Feature-flag Overwolf code paths so the same codebase can run as vanilla Electron without Overwolf features. Standard Electron builds degrade to the current behavior (voice input, manual augment picker, separate window).

### Distribution

- Self-hosted distribution is allowed — not locked to the Overwolf store
- Requires own code-signing certificate
- Overwolf provides optional CDN, installer, and auto-updater
- Requires Overwolf approval process (submit app idea, QA review, DevRel manager assigned)

### Revenue sharing (if using Overwolf monetization)

| Model                 | Split (developer / Overwolf) |
| --------------------- | ---------------------------- |
| Ads                   | 70/30                        |
| Subscriptions (Tebex) | 85/15                        |

Not required — the app can be free or use its own payment system.

### Platform limitations

- GEP and overlay are **Windows-only** currently
- Mac/Linux support for GEP/overlay is "in development" (only ads work cross-platform)
- Vanilla Electron builds work cross-platform but without Overwolf features
