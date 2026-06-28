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

- Augments (any mode) — the Live Client Data API does not expose augment offers or selections. In ARAM Mayhem, augment selection happens at levels 1, 7, 11, and 15 (4 total per game), but only after the player returns to the Nexus at that level. The API exposes player level but not whether they're at the Nexus or have an augment offer pending. **Programmatic detection is possible via Overwolf GEP** — see `docs/research/augment-detection-research.md` for full findings. The app currently uses voice/manual input as a fallback; the migration to ow-electron (see `docs/ow-electron-migration-plan.md`) will add GEP-based detection.
- Some augments auto-select a follow-up (e.g., Transmute: Chaos grants two random augments instead of one). This can happen once per game, meaning a player can end up with 5 augments total (4 chosen + 1 granted). The API doesn't expose these auto-selections, so the app needs a way to record the granted augment. The UI should distinguish between "chosen" slots (4 max) and a "granted" slot that appears as a result of choosing certain augments. With voice input, the user can report all augments received in one utterance.

### ARAM Mayhem augment re-roll mechanics

When augment selection is triggered, the player sees 3 augment cards. Each card has its own single-use re-roll button.

- **Round 1:** 3 cards shown, each with a re-roll button. Best strategy: identify the best card, re-roll the other two.
- **Round 2:** 2 new cards replace the re-rolled ones. The kept card still has its re-roll available; the 2 new cards do not (their re-rolls were already used). Three possible outcomes:
  - A new card is better than the kept card: re-roll the kept card (its re-roll hasn't been used yet). Proceed to round 3.
  - The kept card is still best: take it. No more re-rolls available on the other two cards.
- **Round 3** (only if the kept card was re-rolled in round 2): 1 new card replaces it. All 3 cards now have no re-rolls remaining. Pick the best of the 3 final cards.

Key rules:

- Maximum 3 re-rolls per augment selection, tied to card positions (not free-floating)
- A card whose re-roll has been used cannot be re-rolled again, even if it was replaced by a new card
- The player may only report the NEW cards after re-rolling; the system must remember which card was kept from prior rounds

- Enemy gold (only active player's gold)
- Ability cooldowns (Riot policy)
- Detailed stats for other players
- Minimap positions

## LCU (League Client Update) API

The League Client exposes a separate local API alongside the Live Client Data API. The Live Client Data API is the in-game server (port 2999, only available during a game). The LCU is the launcher/client application — it runs whenever the League client is open, on a **dynamic port** with HTTPS + Basic auth.

### Discovery

Credentials are in a lockfile at `{League Install Dir}/lockfile`, readable from WSL2 via `/mnt/c/Riot Games/League of Legends/lockfile`. Format: `process:pid:port:auth_token:protocol`. Auth is Basic with username `riot` and the token as password. Port and token change every time the client restarts. The lockfile only exists while the client is running.

### REST endpoints (polled)

| Endpoint                              | When available                                 | What it returns                                                                      |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/lol-summoner/v1/current-summoner`   | Always (while client is open)                  | Summoner info: `gameName`, `tagLine`, `summonerLevel`, `puuid`, `profileIconId`      |
| `/lol-gameflow/v1/gameflow-phase`     | Always                                         | Current phase as a string (see lifecycle below)                                      |
| `/lol-gameflow/v1/session`            | During any game flow (lobby through post-game) | Queue info: `gameMode`, queue type, map ID, team size. Updates on phase transitions. |
| `/lol-champ-select/v1/session`        | During ChampSelect phase only                  | Full champ select state: picks, bans, player assignments, timer                      |
| `/lol-end-of-game/v1/eog-stats-block` | During PreEndOfGame and EndOfGame phases only  | Full post-game stats (see below)                                                     |

### Gameflow phase lifecycle (observed)

```
None → Lobby → Matchmaking → ReadyCheck → ChampSelect → InProgress → PreEndOfGame → EndOfGame → Lobby
```

- **None**: Client is open but not in any game flow
- **Lobby**: Player has selected a mode and is in the lobby (can see party, queue button)
- **Matchmaking**: Queue is active, searching for a match
- **ReadyCheck**: Match found, accept/decline prompt (~10 seconds)
- **ChampSelect**: Champion selection phase (ARAM: random assignment + trades)
- **InProgress**: Game is running (Live Client Data API is also available during this phase)
- **PreEndOfGame**: Nexus destroyed, game ending. End-of-game stats ARE available at this point.
- **EndOfGame**: Post-game screen showing stats/honor. Stats still available.
- Returns to **Lobby** when the player exits the post-game screen.

### Champ select session (`/lol-champ-select/v1/session`)

Available during the ChampSelect phase. Fires on every change (pick, ban, timer tick, trade). Captured from Practice Tool on 2026-03-29.

**Key fields:**

- `localPlayerCellId` — numeric cell ID identifying the local player (0-indexed)
- `myTeam[]` — array of allied player objects:
  - `cellId` — position in the draft (0-indexed)
  - `championId` — numeric champion key (0 = not yet picked). Maps to `Champion.key` in our data ingest.
  - `championPickIntent` — numeric champion key the player is hovering before lock-in (0 = none)
  - `assignedPosition` — role string: `"top"`, `"jungle"`, `"middle"`, `"bottom"`, `"utility"`, or `""` (empty in ARAM/Arena)
  - `gameName` — Riot ID game name (only populated for the local player; empty for teammates in ranked)
  - `tagLine` — Riot ID tagline
  - `spell1Id`, `spell2Id` — summoner spell IDs (4=Flash, 12=Teleport, 14=Ignite, 11=Smite, 21=Barrier, etc.)
  - `selectedSkinId` — skin ID (championId \* 1000 + skin number)
  - `team` — team number (1 = blue/ORDER, 2 = red/CHAOS)
  - `isHumanoid` — boolean (false for the local player in Practice Tool, true for bots that simulate humans)
  - `nameVisibilityType` — `"VISIBLE"` or `"HIDDEN"` (hidden for enemy team in ranked)
  - `puuid` — player UUID
- `theirTeam[]` — same structure as `myTeam[]`, for the enemy team. Champion IDs are 0 in modes where enemy picks are hidden during champ select.
- `bans` — `{ myTeamBans: number[], theirTeamBans: number[], numBans: number }`
- `benchChampions[]` — array of available bench champions (ARAM trade pool)
- `benchEnabled` — boolean (true in ARAM)
- `actions[][]` — nested array of pick/ban actions:
  - `actorCellId` — which player is acting
  - `championId` — champion being picked/banned
  - `completed` — boolean (true = locked in)
  - `isInProgress` — boolean (true = currently this player's turn)
  - `type` — `"pick"` or `"ban"`
- `timer` — current phase timer:
  - `phase` — `"BAN_PICK"`, `"FINALIZATION"`, `"GAME_STARTING"`, or `""`
  - `adjustedTimeLeftInPhase` — milliseconds remaining
  - `totalTimeInPhase` — total milliseconds for this phase
- `isCustomGame` — boolean
- `queueId` — numeric queue ID (e.g., 3140 for Practice Tool)
- `trades[]` — available trade offers between teammates
- `gameId` — numeric game ID

**Champion ID resolution:** The LCU uses numeric champion keys (e.g., 136 = Aurelion Sol, 497 = Rakan). These map to `Champion.key` in our DDragon data ingest. Use `resolveChampionName()` from `src/lib/data-ingest/champion-id-map.ts` for reverse lookup.

### End-of-game stats (`/lol-end-of-game/v1/eog-stats-block`)

Available at the `PreEndOfGame` phase transition (immediately when the nexus dies — ~20 seconds before `EndOfGame`).

**What it provides:**

- `gameId` — unique game identifier
- `gameMode` — internal mode name (`KIWI` for ARAM Mayhem, `CLASSIC` for SR, `CHERRY` for Arena)
- `gameLength` — duration in seconds
- `teams[]` — array of two team objects, each with:
  - `isWinningTeam` — boolean
  - `isPlayerTeam` — boolean (identifies which team the local player was on)
  - `players[]` — array of player objects with:
    - `championId` — numeric champion ID (NOT champion name — must map via our data ingest)
    - `detectedTeamPosition` — role string (populated in SR, empty in ARAM)
    - `items[]` — array of 7 item IDs (final build, 0 for empty slots)
    - `summonerName` — may be empty in some cases
    - `botPlayer` — boolean
    - `leaver` — boolean
- `queueType` — queue identifier string
- `ranked` — boolean
- `gameEndedInEarlySurrender` — boolean (remake detection)

**What it does NOT provide:**

- Champion names (only numeric IDs)
- Augment selections (confirmed: `AUGMENT` inventory events are cosmetic augment ownership, not in-game picks)
- Player summoner names are sometimes empty
- KDA/stats per player (not in the eog-stats-block — only available from the Live Client Data API during the game)

### Remake detection (`gameEndedInEarlySurrender`)

A remade game (a player fails to connect, the team votes to void the match near the 3-minute mark) is a third outcome, neither a win nor a loss. Two LCU sources expose it:

- **eog-stats-block:** `gameEndedInEarlySurrender` is a top-level boolean. A remade game also has `isWinningTeam: false` for every team, so deriving win/loss from `isWinningTeam` alone mis-labels a remake as a loss.
- **match-history:** remade games DO appear in `/lol-match-history` (verified by direct LCU query). The flag lives per-participant at `participants[].stats.gameEndedInEarlySurrender`. `gameDuration` is short (~150s observed) but is the only other tell.

Do NOT confuse this with `gameEndedInSurrender`, the normal 15:00+ forfeit. That still records a real win or loss and must stay win/loss. The app-side phase timing (InProgress to WaitingForStats) reads ~3:00 for a remake because it includes the post-nexus wait; that is not the real game length, so do not use duration as a remake heuristic. Use the flag.

The app models the outcome as the `GameResult` union (`win` | `loss` | `remake`) in `src/lib/game-result.ts`; `deriveGameResult()` maps the two flags. Remakes are excluded from win/loss and KDA aggregates (`windowStats`) and never trigger the post-game takeaway LLM call.

### Game mode internal names

| Display name    | Live Client Data API `gameMode` | LCU `gameMode` | Live Client `mapNumber` | Constant           |
| --------------- | ------------------------------- | -------------- | ----------------------- | ------------------ |
| ARAM Mayhem     | `KIWI`                          | `KIWI`         | 12                      | `GAME_MODE_MAYHEM` |
| Regular ARAM    | `ARAM` (assumed, untested)      | `ARAM`         | 12                      | `GAME_MODE_ARAM`   |
| Summoner's Rift | `CLASSIC`                       | `CLASSIC`      | 11                      | -                  |
| Arena           | `CHERRY`                        | `CHERRY`       | 30                      | `GAME_MODE_ARENA`  |
| Practice Tool   | `PRACTICETOOL`                  | `PRACTICETOOL` | underlying map id       | n/a                |

For all queued modes, `gameMode` and the LCU `gameMode` agree. Practice Tool is the exception: BOTH sources echo `PRACTICETOOL` (verified empirically with the LCU `/lol-gameflow/v1/session` queue block) regardless of which map the player picked, so the only way to recover the underlying mode for a Practice Tool session is the Live Client `gameData.mapNumber` field. Mode detection uses `detectMode(registry, liveGameMode, lcuGameMode, mapNumber)` in `src/lib/mode/detect.ts`. The function tries `liveGameMode` first, falls back to `lcuGameMode`, and finally translates `mapNumber` through a `MAP_TO_MODE` table (11 -> CLASSIC, 12 -> ARAM, 30 -> CHERRY). Without these fallbacks Practice Tool silently disables the coaching pipeline because no registered mode matches `PRACTICETOOL`. Note: Mayhem (KIWI) shares map 12 with regular ARAM but is queue-only and cannot be opened in Practice Tool, so map 12 in Practice Tool resolves to ARAM. Regular ARAM has not been tested in-game yet - the `GAME_MODE_ARAM` ("ARAM") value is assumed from documentation. ARAM Mayhem consistently returns "KIWI" (tested patch 15.6). Constants are defined in `src/lib/mode/types.ts`.

### WebSocket (real-time events)

WAMP 1.0 protocol at `wss://127.0.0.1:{port}/` with the same Basic auth. Subscribe with `[5, "OnJsonApiEvent"]` to receive all events.

**Event format:** `[8, "OnJsonApiEvent", { uri, eventType, data }]`

- `eventType`: `Create`, `Update`, or `Delete`
- `uri`: the REST endpoint path that changed
- `data`: the new value (same shape as the REST endpoint would return)

#### Core events — Game Lifecycle

| URI                                                      | What it provides                                                                                      | When it fires                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `/lol-gameflow/v1/gameflow-phase`                        | Phase string (None, Lobby, Matchmaking, ReadyCheck, ChampSelect, InProgress, PreEndOfGame, EndOfGame) | Every phase transition                |
| `/lol-gameflow/v1/session`                               | Queue info: gameMode, queue type, map ID, team size                                                   | Phase transitions and session changes |
| `/lol-gameflow/v1/availability`                          | Whether matchmaking is available                                                                      | Client state changes                  |
| `/lol-gameflow/v1/gameflow-metadata/player-status`       | Player status metadata                                                                                | Phase transitions                     |
| `/lol-gameflow/v1/gameflow-metadata/registration-status` | Registration status                                                                                   | Phase transitions                     |

#### Core events — Champ Select

| URI                                               | What it provides                                                   | When it fires                    |
| ------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `/lol-champ-select/v1/session`                    | Full champ select state: picks, bans, timers, trades, bench (ARAM) | Every change during champ select |
| `/lol-champ-select/v1/current-champion`           | Currently assigned champion                                        | Champion assignment/trade        |
| `/lol-champ-select/v1/grid-champions/{id}`        | Per-champion availability in the grid                              | Start of champ select (bulk)     |
| `/lol-champ-select/v1/summoners/{id}`             | Per-summoner state in champ select                                 | Player actions                   |
| `/lol-champ-select/v1/pickable-champion-ids`      | List of pickable champion IDs                                      | Start of champ select            |
| `/lol-champ-select/v1/bannable-champion-ids`      | List of bannable champion IDs                                      | Start of champ select            |
| `/lol-champ-select/v1/disabled-champion-ids`      | Globally disabled champions                                        | Start of champ select            |
| `/lol-champ-select/v1/all-grid-champions`         | Full champion grid                                                 | Start of champ select            |
| `/lol-champ-select/v1/skin-carousel-skins`        | Available skins for selected champion                              | Champion lock-in                 |
| `/lol-champ-select/v1/skin-selector-info`         | Skin selection state                                               | During champ select              |
| `/lol-champ-select/v1/team-boost`                 | Team skin boost status                                             | During champ select              |
| `/lol-champ-select/v1/pin-drop-notification`      | Pin/position notifications                                         | During champ select              |
| `/lol-champ-select/v1/sfx-notifications`          | Sound effect triggers                                              | During champ select              |
| `/lol-lobby-team-builder/champ-select/v1/session` | Alternative champ select session (team builder variant)            | During champ select              |

#### Core events — Lobby & Matchmaking

| URI                                            | What it provides                             | When it fires                              |
| ---------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `/lol-lobby/v2/lobby`                          | Full lobby state: game mode, party, settings | Lobby creation, mode change, party updates |
| `/lol-lobby/v2/lobby/members`                  | Party member list                            | Members join/leave                         |
| `/lol-lobby/v2/lobby/countdown`                | Queue countdown timer                        | During matchmaking                         |
| `/lol-lobby/v2/lobby/matchmaking/search-state` | Matchmaking search status                    | During matchmaking                         |
| `/lol-lobby/v2/comms/members`                  | Voice comms member state                     | Party changes                              |
| `/lol-lobby/v2/party-active`                   | Whether a party is active                    | Party state changes                        |
| `/lol-lobby/v2/party/eog-status`               | Post-game party status                       | After game ends                            |
| `/lol-lobby/v1/parties/gamemode`               | Selected game mode                           | Mode selection                             |
| `/lol-matchmaking/v1/search`                   | Matchmaking search: ETA, state, errors       | During matchmaking                         |
| `/lol-matchmaking/v1/ready-check`              | Ready check status (accept/decline)          | Match found                                |
| `/lol-lobby-team-builder/v1/matchmaking`       | Team builder matchmaking state               | During matchmaking                         |

#### Core events — End of Game

| URI                                            | What it provides                                       | When it fires                |
| ---------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `/lol-end-of-game/v1/eog-stats-block`          | Full post-game stats (see REST endpoint section above) | PreEndOfGame/EndOfGame phase |
| `/lol-end-of-game/v1/champion-mastery-updates` | Mastery points gained                                  | EndOfGame phase              |
| `/lol-pre-end-of-game/v1/currentSequenceEvent` | Pre-end-of-game animation sequence                     | PreEndOfGame phase           |
| `/lol-honor-v2/v1/ballot`                      | Honor voting options                                   | EndOfGame phase              |
| `/lol-honor-v2/v1/team-choices`                | Which teammates were honored                           | During honor voting          |
| `/lol-honor-v2/v1/vote-completion`             | Honor voting completed                                 | After voting                 |
| `/lol-honor-v2/v1/mutual-honor`                | Mutual honor notification                              | After voting                 |
| `/lol-honor-v2/v1/recipients`                  | Honor recipients                                       | After voting                 |
| `/lol-honor-v2/v1/recognition`                 | Honor recognition received                             | After voting                 |

#### Potentially useful events — Future features

| URI                                                                                | What it provides                                    | Potential use                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------- |
| `/lol-summoner/v1/current-summoner`                                                | Summoner name, level, puuid                         | Identity, display                     |
| `/lol-chat/v1/conversations`                                                       | Chat conversations                                  | Future: friend messages notification  |
| `/lol-chat/v1/friends`                                                             | Friends list                                        | Future: party awareness               |
| `/lol-game-client-chat/v1/instant-messages`                                        | In-game chat messages                               | Future: chat-based input              |
| `/lol-ranked/v1/current-lp-change-notification`                                    | LP gain/loss after ranked game                      | Future: ranked tracking               |
| `/lol-challenges/v1/updated-challenges/{gameId}`                                   | Challenge progress updates                          | Future: challenge tracking            |
| `/lol-missions/v1/missions`                                                        | Mission progress                                    | Future: mission tracking              |
| `/lol-perks/v1/currentpage`                                                        | Current rune page                                   | Future: rune page detection           |
| `/lol-perks/v1/pages`                                                              | All rune pages                                      | Future: rune recommendations          |
| `/lol-inventory/v2/inventory/AUGMENT`                                              | Cosmetic augment inventory (NOT in-game selections) | Not useful for coaching               |
| `/riot-messaging-service/v1/message/lol-gsm-server/v1/gsm/game-update/IN_PROGRESS` | Game server state update (in progress)              | Alternative game detection signal     |
| `/riot-messaging-service/v1/message/lol-gsm-server/v1/gsm/game-update/TERMINATED`  | Game server state update (terminated)               | Alternative game-end detection signal |

#### Other observed events

Events observed during a full ARAM Mayhem game session that don't fall into the categories above:

**Patcher & Updates:**

- `/patcher/v1/products/*` — background patch checking (fires every ~60s)
- `/lol-patch/v1/products/*` — patch coordination
- `/data-store/v1/install-settings/*` — patcher lock, game settings, perks settings (fires every ~30s)

**Store & Inventory:**

- `/lol-catalog/v1/items/*` — store catalog items (CHAMPION, CHAMPION_SKIN, CURRENCY, EMOTE, EVENT_PASS, PROGRESSION, SUMMONER_ICON)
- `/lol-inventory/v2/inventory/*` — inventory by type (ACHIEVEMENT_TITLE, ARAM_BOON, AUGMENT, CURRENCY, EMOTE, PROGRESSION, QUEUE_ENTRY, REGALIA_BANNER, REGALIA_CREST, SKIN_AUGMENT, SKIN_BORDER, SPELL_BOOK_PAGE, SUMMONER_ICON, TFT_EVENT_PVE_BUDDY, TFT_EVENT_PVE_DIFFICULTY, TFT_PLAYBOOK, TFT_ZOOM_SKIN, TOURNAMENT_FLAG, TOURNAMENT_LOGO, TOURNAMENT_TROPHY, WARD_SKIN)
- `/lol-inventory/v1/wallet/*` — currency wallets
- `/lol-store/v1/store-ready` — store readiness
- `/lol-marketplace/v1/products/*` — marketplace products
- `/lol-yourshop/v1/status` — personalized shop status
- `/payments/v1/pmc-start-url` — payment system

**Cosmetics & Loadouts:**

- `/lol-collections/v1/inventories/*` — cosmetic collections
- `/lol-cosmetics/v1/inventories/*` — TFT cosmetics (companions, damage-skins, map-skins, playbooks, zoom-skins)
- `/lol-cosmetics/v1/favorites/*` — TFT cosmetic favorites
- `/lol-loadouts/v4/*` — loadout management
- `/lol-sanctum/v1/banners` — profile banners

**Loot & Rewards:**

- `/lol-loot/v1/player-loot/*` — hextech crafting loot items (~50+ events on connect, per-item URIs)
- `/lol-loot/v1/player-loot-map` — full loot map
- `/lol-loot/v1/recipes/configuration` — crafting recipes
- `/lol-loot/v1/ready` — loot system readiness
- `/lol-loot/v1/currency-configuration` — currency config
- `/lol-loot/v1/loot-grants` — loot grants
- `/lol-loot/v1/milestones/items` — milestone items
- `/lol-loot/v2/player-loot-map` — v2 loot map
- `/lol-rewards/v1/grants` — reward grants

**Events & Missions:**

- `/lol-event-hub/v1/events` — event pass events
- `/lol-event-hub/v1/navigation-button-data` — event hub navigation
- `/lol-event-hub/v1/skins` — event skins
- `/lol-event-hub/v1/token-upsell` — event token upsell
- `/lol-event-mission/v1/event-mission` — event missions
- `/lol-objectives/v1/objectives/lol` — LoL objectives
- `/lol-objectives/v1/objectives/tft` — TFT objectives

**Champions & Mastery:**

- `/lol-champions/v1/inventories/*` — champion inventories
- `/lol-champions/v1/owned-champions-minimal` — owned champion list
- `/lol-champion-mastery/v1/local-player/champion-mastery-score` — mastery score
- `/lol-champion-mastery/v1/notifications` — mastery notifications

**Progression & Ranking:**

- `/lol-progression/v1/groups` — progression groups
- `/lol-summoner-profiles/v1/get-summoner-level-view` — summoner level view
- `/lol-regalia/v2/summoners/*` — summoner regalia

**Auth & Session:**

- `/entitlements/v1/token` — entitlements token
- `/lol-league-session/v1/league-session-token` — session token
- `/lol-rso-auth/v1/authorization` — RSO auth
- `/lol-rso-auth/v1/authorization/access-token` — access token
- `/lol-rso-auth/v1/authorization/id-token` — ID token
- `/lol-rso-auth/v1/authorization/userinfo` — user info
- `/lol-login/v1/session` — login session
- `/lol-login/v1/login-data-packet` — login data
- `/lol-login/v1/login-platform-credentials` — platform credentials
- `/lol-login/v1/wallet` — login wallet

**Client Configuration:**

- `/lol-client-config/v3/client-config/*` — ~90+ config keys covering experiments, features, queues, perks, champ select settings, store settings, etc. All fire on connect.
- `/lol-platform-config/v1/namespaces/*` — platform config: enabled queues, free rotation, game modes, season info, spectator settings

**Settings:**

- `/lol-settings/v1/account/*` — account settings (champ-select, game-settings, input-settings, lol-home, page-settings)
- `/lol-settings/v2/account/*` — v2 account settings (GamePreferences, LCUPreferences, PerksPreferences)
- `/lol-settings/v2/config` — settings config
- `/lol-game-settings/v1/game-settings` — in-game settings
- `/lol-game-settings/v1/input-settings` — input settings
- `/lol-game-settings/v1/ready` — game settings readiness
- `/lol-player-preferences/v1/player-preferences-ready` — player preferences readiness

**Social:**

- `/lol-chat/v2/friend-requests` — friend requests
- `/lol-chat/v1/blocked-players` — blocked players
- `/lol-chat/v1/player-mutes` — muted players
- `/lol-hovercard/v1/friend-info/*` — friend hover card info
- `/lol-suggested-players/v1/suggested-players` — suggested players

**TFT-specific:**

- `/lol-tft-pass/v1/active-passes` — TFT passes
- `/lol-tft-pass/v1/battle-pass` — TFT battle pass
- `/lol-tft-pass/v1/event-pass` — TFT event pass
- `/lol-tft-skill-tree/v1/skill-tree` — TFT skill tree

**Clash:**

- `/lol-clash/v1/checkin-allowed` — clash check-in status
- `/lol-clash/v1/enabled` — clash enabled
- `/lol-clash/v1/playmode-restricted` — clash playmode restriction
- `/lol-clash/v1/ready` — clash readiness
- `/lol-clash/v1/time` — clash time
- `/lol-clash/v1/visible` — clash visibility
- `/lol-clash/v2/playmode-restricted` — v2 playmode restriction

**System:**

- `/error-monitor/v1/logs/changed` — error log changes
- `/lol-premade-voice/v1/availability` — voice chat availability
- `/lol-premade-voice/v1/settings` — voice chat settings
- `/lol-replays/v1/configuration` — replay system config
- `/lol-vanguard/v1/notification` — anti-cheat notifications
- `/lol-simple-dialog-messages/v1/messages` — simple dialog messages
- `/lol-npe-tutorial-path/v1/*` — new player experience
- `/process-control/v1/process` — process control
- `/riotclient/affinity` — client affinity
- `/riotclient/pre-shutdown/begin` — pre-shutdown signal
- `/riotclient/ux-allow-foreground` — UX foreground permission
- `/riotclient/ux-flash` — UX flash (taskbar attention)
- `/riotclient/ux-state/request` — UX state request

**Riot Messaging Service (RMS):**

- `/riot-messaging-service/v1/message/cap/progression/v1/notifications/cache/invalidate` — progression cache invalidation
- `/riot-messaging-service/v1/message/cap/v1/wallets` — wallet updates
- `/riot-messaging-service/v1/message/challenges/v1/notifications/updated-challenges` — challenge updates
- `/riot-messaging-service/v1/message/championmastery/v1/notifications/champion-mastery-change` — mastery changes
- `/riot-messaging-service/v1/message/honor/post-game-ceremony` — honor ceremony
- `/riot-messaging-service/v1/message/honor/vote-completion` — honor vote completion
- `/riot-messaging-service/v1/message/lol-gsm-server/v1/gsm/game-update/IN_PROGRESS` — game server: game in progress
- `/riot-messaging-service/v1/message/lol-gsm-server/v1/gsm/game-update/TERMINATED` — game server: game terminated
- `/riot-messaging-service/v1/message/lol-platform/v1/gsm/stats` — game server stats
- `/riot-messaging-service/v1/message/missions/v1/player` — mission updates
- `/riot-messaging-service/v1/message/parties/v1/notifications` — party notifications
- `/riot-messaging-service/v1/message/rewards/v1/grant` — reward grants
- `/riot-messaging-service/v1/message/summoner/v1/views` — summoner view updates
- `/riot-messaging-service/v1/message/summoner/v1/xp` — XP updates
- `/riot-messaging-service/v1/message/teambuilder/v1/rerollInfoV1` — ARAM reroll info
- `/riot-messaging-service/v1/message/teambuilder/v1/tbdGameDtoV1` — team builder game data

#### Key finding: No in-game augment data from LCU or Live Client Data API

Confirmed by monitoring a full ARAM Mayhem game: no LCU WebSocket event, LCU REST endpoint, or Live Client Data API endpoint exposes which augments a player is offered or selects during gameplay. The `AUGMENT` inventory type (`/lol-inventory/v2/inventory/AUGMENT`) contains cosmetic augment ownership (Arena augment skins), not in-game selections. The LCU WebSocket subscribes to `OnJsonApiEvent` (the broadest possible subscription) — augment events simply do not exist in this API. This is a fundamental limitation: the LCU is the client/launcher process, while augment selection happens in the game process.

**However, Overwolf's Game Events Provider (GEP) does expose augment data** — see `docs/research/augment-detection-research.md` for the full investigation. GEP hooks into the game process via a Vanguard-whitelisted DLL and provides `augments` (the 3 offered choices) and `picked_augment` (which one was selected) events for both ARAM Mayhem and Arena modes.

### WSL2 access

Confirmed working: the LCU REST API and WebSocket are both reachable from WSL2 at `127.0.0.1:{port}` with the lockfile credentials. Self-signed cert requires `NODE_TLS_REJECT_UNAUTHORIZED=0` for Node.js scripts or `danger_accept_invalid_certs` for Rust/reqwest (same as the Live Client Data API proxy).

### Two-API strategy

During a game, both APIs are available and serve different purposes:

| Data need                                  | Source                                 | Available when                |
| ------------------------------------------ | -------------------------------------- | ----------------------------- |
| Live player stats, KDA, items, level, gold | Live Client Data API (port 2999)       | InProgress phase only         |
| Game mode, augment selections              | Manual input (voice/UI)                | Anytime                       |
| Win/loss, final items, game length         | LCU end-of-game endpoint               | PreEndOfGame/EndOfGame phases |
| Phase transitions, matchmaking status      | LCU gameflow phase (poll or WebSocket) | Always (while client is open) |
| Champion names from IDs                    | Our data ingest (DDragon)              | Always (cached locally)       |

The app should use the Live Client Data API for real-time game state during play, and the LCU for lifecycle management (detecting game start/end) and post-game data capture (win/loss, final build).

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

**Gotcha: `item.mode` is an exclusive ID-range partition, not "available in mode."** `classifyItemMode` (in `data-dragon.ts`) assigns each item exactly ONE mode by its ID range, so `filterItemsByMode(items, "aram")` returns ONLY the ~21 ARAM variant items (mana/enchanter/tank rebalances: Tear, Archangel's, Winter's Approach, Dawncore, Redemption, Frozen Heart, ...), NOT the ~254 standard items ARAM is actually played with. Never use it as a "purchasable in this mode" filter. Feeding that 21-item set to the game-plan `buildPath` name enum collapsed the model's choices to those mana items and cornered it into a Winter's Approach x6 build. A correct "purchasable in ARAM" set is the standard items with the variant overlay applied, not the `"aram"` partition.

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

**Multi-set augments (historical, pre-26.12):** Before the rework, some Mayhem augments belonged to two sets and the wiki `set` field used `<br>` to separate them, each with `[[File:...]] [[Page|SetName]]` markup. The 26.12 rework removed Traits and `fetchWikiAugments` no longer reads the `set` field, so this parsing is gone. The field still exists in the wiki module as stale legacy data.

**Augment set bonuses (Traits): REMOVED in the 26.12 Mayhem rework.** Mayhem replaced grouped Traits with champion-first Ability Augments. `getMayhemAugmentSets()` now returns `[]` and `fetchWikiAugments` no longer reads the wiki `set` field, so no set/trait data reaches the coaching LLM. The wiki's `MayhemAugmentData` module still carries stale `set` tags on legacy augments and the `ARAM: Mayhem/Augment Sets` article page still exists, but both describe a removed mechanic and are deliberately ignored. The function and the `augmentSets` plumbing are kept as an inert, presence-driven seam so grouping can be repopulated cheaply if Riot reintroduces it. Source: https://www.leagueoflegends.com/en-us/news/dev/dev-augmentmaxxing-aram-mayhem/. See [PBE patchline](#pbe-patchline-live-vs-pbe-data) below.

**Cross-mode augment overlap:** Many augments exist in both Mayhem and Arena with the same name. Stored as separate entries with `arena:`-prefixed keys for duplicates to avoid data loss. (Pre-26.12 Mayhem data was richer because it carried set info; post-rework Mayhem augments are setless, so the two modes' augment shapes now differ only by mode and description source.)

**Parsing notes:**

- Use `luaparse` (not regex). Augment descriptions contain `}}` from wiki templates that break regex-based entry matching.
- The raw Lua has a `-- <pre>` wrapper that must be stripped before parsing.
- `ChampionData`, `MayhemAugmentData`, and `ArenaAugmentData` all contain unicode characters luaparse rejects in `x-user-defined` mode — that mode allows only `\x00-\x7f` plus the `-` private range, so _any_ non-ASCII code point throws `code unit U+XXXX is not allowed in the current encoding mode`. Observed culprits: U+2018/U+2019 curly singles, U+201C/U+201D curly doubles, U+2013/U+2014 en/em dashes, and math symbols in stat formulas (U+00F7 `÷`, U+00D7 `×`, U+2212 `−`, U+2248 `≈`). The wiki adds and removes these without warning. `sanitizeForLuaParse` in `src/lib/data-ingest/parsers/lua-parser.ts` is the single normalization point; every wiki Lua source must run input through it before calling `luaparse.parse`. Curly doubles are mapped to `\"` (escaped) since they almost always appear inside double-quoted Lua string literals; mapping to a bare `"` would terminate the literal mid-content.
- Per-character whitelisting in `sanitizeForLuaParse` is whack-a-mole: each new symbol the wiki introduces crashes ingest until added. The named replacements there are readability polish only — the load-bearing guard is the final catch-all `.replace(/[^\x00-\x7f]/g, "")` that strips every remaining non-ASCII character. A new wiki symbol degrades that one description; it can no longer crash the pipeline.
- Wiki markup in descriptions uses `{{as|...}}`, `{{tip|key|display}}`, `{{pp|...}}`, `[[[File:...]]`, `'''bold'''`, `''italic''`. All stripped during ingest.
- `loadGameData` falls back to the last cached payload when any ingest source throws (network failure, wiki parse break, schema drift). The error is logged via the `data-ingest` logger but the app stays usable on stale data. Only when there is no cache to fall back to does the error propagate. Forced refreshes via the exported `fetchAndCache` deliberately do NOT have this fallback - if a user explicitly asks for a refresh and it fails, they should be told.

### Community Dragon (augment IDs/icons)

- **Cherry augments:** `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`. The `latest` segment is the live branch; see [PBE patchline](#pbe-patchline-live-vs-pbe-data) for the parallel `pbe` branch.
- Contains augments from ALL modes mixed together (count grows each patch: 575 on live, 637 on PBE as of 2026-06-07). Only 4 fields per entry: `id`, `nameTRA`, `augmentSmallIconPath`, `rarity`. No enabled/disabled flag, so real augments cannot be distinguished from test/internal entries by metadata alone.
- CDragon-only augments (not matched to any wiki source) are **skipped** during merge. They have no descriptions and include junk entries like "404 Augment Not Found" (which IS real in Arena, but sourced from the wiki instead).

**Icon paths encode game mode:**

| Path pattern                | Mode   |
| --------------------------- | ------ |
| `UX/Kiwi/`                  | Mayhem |
| `UX/Cherry/` (without Kiwi) | Arena  |
| `UX/Strawberry/`            | Swarm  |

**Duplicate entries:** Same augment name can appear with different IDs (e.g., ADAPt as both 205 and 1205). The 1000+ range appears to be Mayhem-specific IDs, lower range is Arena. When merging, prefer the entry whose mode matches the wiki source.

**Name matching quirks:** CDragon names can differ slightly from wiki names, e.g. "Get Excited!" vs "Get Excited" (punctuation) or "Sneakerhead" vs "Quest: Sneakerhead" (prefix). `normalizeForMatch` lowercases, turns punctuation into spaces (so hyphenated and spaced forms agree), collapses whitespace, and drops a leading "quest" marker so quest augments match their non-prefixed counterpart.

### Augment descriptions: where each mode's text comes from (CHERRY / KIWI / STRAWBERRY)

Augments are a per-mode mechanic with THREE distinct pools that share one catalog file. Riot's internal mode codenames (the source of the `cherry`/`kiwi`/`strawberry` strings in icon paths and bin folders):

| Codename   | Mode        | Catalog icon path | Catalog `augmentNameId` prefix | Distinct pool (wiki, 2026-06-20) |
| ---------- | ----------- | ----------------- | ------------------------------ | -------------------------------- |
| CHERRY     | Arena       | `UX/Cherry/`      | (none)                         | 256                              |
| KIWI       | ARAM Mayhem | `UX/Kiwi/`        | `ARAM_`                        | 164                              |
| STRAWBERRY | Swarm (PvE) | `UX/Strawberry/`  | `Strawberry_`/`Weapon_`/...    | unsupported                      |

These are SEPARATE pools, not the same augments. Mayhem and Arena share only 126 names; 38 are Mayhem-only (Droppybara, Hand of Baron, Holy Snowball, Final City Transit, King Me...) and 130 are Arena-only. Even shared-name augments are distinct, independently tuned instances: ADAPt is id 205 (Arena) AND id 1205 `ARAM_ADAPt` (Mayhem). `cherry-augments.json` is a legacy all-modes bundle, not Arena-only; classify by icon path (`classifyAugmentMode`).

**Catalog vs description split (the root of Mayhem staleness).** `cherry-augments.json` is the only place carrying id/name/icon/rarity/mode, but it has NO description text. Where the readable text comes from differs by mode:

| Mode   | Catalog (id/name/icon/rarity) | Description source we use today | Fresher machine source (exists, currently unused)                                  |
| ------ | ----------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Arena  | cherry-augments.json          | wiki `Module:ArenaAugmentData`  | `cdragon/arena/en_us.json` (desc + dataValues, patch-day, PBE-ahead)               |
| Mayhem | cherry-augments.json          | wiki `Module:MayhemAugmentData` | raw per-mode bin `game/maps/modespecificdata/kiwi.bin.json` + string table (below) |

**Mayhem descriptions from raw game data (the recipe).** Mirrors CDTB's `arenadata.py`, pointed at the KIWI mode bin instead of the hardcoded Arena `map30.bin`. Three endpoints (`{branch}` = `latest` or `pbe`):

- Catalog (id to apiName): `.../{branch}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`
- KIWI augment DB (apiName to desc/tooltip string keys + `RootSpell`): `.../{branch}/game/maps/modespecificdata/kiwi.bin.json` (220 `AugmentData` records on live 16.12)
- String table (key to English text): `.../{branch}/game/en_us/data/menu/en_us/lol.stringtable.json` (~28 MB)

Resolution: collect records where `__type === "AugmentData"` from the KIWI bin, keyed by `AugmentNameId`; resolve `DescriptionTra`/`AugmentTooltipTra`/`NameTra` against the string table by LOWERCASED key; follow `RootSpell` to `mSpell.DataValues` (index 0, Mayhem has no per-level scaling) to substitute `@token@` and `@token*N@` placeholders. The short `desc` resolves 220/220, with ~79% of `@token@` placeholders substituted. The unresolved remainder is computed/quest/sub-spell tokens (`@f1@`, `@QuestRequirement@`, `@Damage@`) that live in `mSpellCalculations` or child spells, which CDTB itself leaves raw; measured live (16.12) they survive in ~29/240 `desc` strings (e.g. "deals `@Damage@` physical damage"), not just the `tooltip` as first thought. That ceiling is accepted, matching the fidelity CDragon ships for Arena. Production must ALSO strip the inline markup the raw strings carry (HTML-like `<keyword>`/`<br>`/`<scaleAP>` tags, `{{SpellName}}` runtime templates, `%i:scaleCrit%` icon markers): `sources/cdragon-kiwi-augments.ts` does this with a targeted stripper, the raw-data analogue of `stripWikiMarkup`. Verified live (no wiki): `ARAM_ADAPt` (1205) "Convert Bonus Attack Damage to Ability Power. Gain 15% Ability Power."; Droppybara (1414) "Gain Droppybara as a Summoner Spell. After a delay, call down a capybara that deals 30% max Health true damage."; Hand of Baron (1389) "Gain 25% Adaptive Force. Nearby allied minions are greatly empowered." Proof script: `scripts/spike-kiwi-augment-descriptions.ts` (`pnpm spike-kiwi`, `-- --pbe`, `-- <ids>`).

**Why CommunityDragon ships no curated KIWI file.** Arena augments live in the Arena map bin (`map30.bin`); the per-mode modes (cherry/kiwi/brawl/...) each have their own `game/maps/modespecificdata/<mode>.bin`. CDTB's Arena exporter hardcodes the old map30 path, so it never resolves the per-mode bins. The data was always present; nobody resolves it for KIWI. Options: self-extract (proven), or file a CDTB feature request for a `kiwi` exporter.

**Freshness ranking (augments, any mode).** Raw per-mode bin / `cherry-augments.json` on `pbe` (next patch, ~2 days early) is freshest, then the same on `latest` (hours after a live patch), then curated `cdragon/arena/en_us.json` (Arena only, patch-day), then the wiki Lua modules (human transcription, days to weeks, gutted and rebuilt on Mayhem reworks), and DDragon NEVER has augments (403 on every augment path). Avoid Meraki/lolstaticdata (abandoned, ~6 months stale) and stat sites (win-rate only, compliance-banned).

### PBE patchline (live vs PBE data)

"Patchline" is Riot's term (the `patchlines` key in `RiotClientInstalls.json`) for the live/PBE choice in the launcher. CommunityDragon serves a parallel `pbe` branch alongside `latest`: swap the branch segment in any cdragon URL (e.g. `.../pbe/plugins/...`). The data-ingest layer threads a `patchline` parameter (default `"live"`); the mapping from patchline to cdragon branch and to cache namespace lives in `src/lib/data-ingest/patchline.ts`.

**The wiki is the description bottleneck.** `cherry-augments.json` carries no descriptions (only `id`, `nameTRA`, icon, `rarity`); readable text comes from the wiki Lua module, which tracks live and is NOT PBE-versioned. So PBE-only augments arrive from cdragon with IDs/icons but no wiki match. `mergeAugmentIds` now keeps the Mayhem (Kiwi-coded) ones with a `MISSING_DESCRIPTION_PLACEHOLDER` so they stay visible to the player and the coaching LLM instead of vanishing until the wiki catches up; the real description flows in unchanged once the wiki adds it. The augment-fit prompt special-cases that placeholder text (rate cautiously from name and tier, do not invent mechanics). Before this, unknown augments were dropped from the data AND `augment-fit/index.ts` silently filtered any unresolved offer name out of the rating list, so a new augment was invisible to coaching. This degrades gracefully, it does not crash. Full readiness still tracks wiki coverage, which we do not control: re-check as the wiki catches up. NOTE: as of the KIWI raw-bin source (see "Mayhem text HAS a machine-readable source" above), the wiki is no longer the Mayhem description bottleneck. `fetchKiwiAugments` now supplies Mayhem descriptions (including PBE-only augments) directly from the raw bin, so this `mergeAugmentIds` placeholder path is a rarely-hit safety net for the Mayhem mode.

**Mayhem keep is junk-free and maps cleanly.** CDragon's test/internal entries (`404 Augment Not Found`, `Augment 405`) are Cherry/Arena-coded, so scoping the keep to Mayhem excludes them for free. CDragon rarity tokens are `kBronze/kEventChoice/kGold/kPrismatic/kSilver`, but Mayhem augments use only `kSilver/kGold/kPrismatic`, which map directly to our `Silver/Gold/Prismatic` tier enum (`rarityToTier` falls back to Silver for anything else). Arena and Swarm carry the other two tokens and stay dropped: Arena's own wiki source is authoritative, Swarm is unsupported.

**Mayhem text HAS a machine-readable source (corrects a prior wrong conclusion).** The curated aggregate `cdragon/arena/en_us.json` is Arena-only (zero Kiwi/Mayhem entries, 228 cherry augments) so it is not a Mayhem fallback, and that is why earlier investigation concluded no machine source existed. It does: the RAW per-mode bin `game/maps/modespecificdata/kiwi.bin.json` plus the game string table resolve all 220 Mayhem descriptions. This is now IMPLEMENTED: `sources/cdragon-kiwi-augments.ts` (`fetchKiwiAugments`) is the primary Mayhem source and the wiki (`fetchWikiAugments`) is demoted to a fallback that fills any description the raw source leaves empty and supplies entries only when the raw fetch yields none. `index.ts` warns (never fails) and leans on the wiki when fewer than 90% of KIWI records resolve a non-empty `desc` (`kiwiResolutionStats` / `KIWI_MIN_RESOLUTION_RATE`). Full recipe, proof, and the freshness map: see [Augment descriptions: where each mode's text comes from](#augment-descriptions-where-each-modes-text-comes-from-cherry--kiwi--strawberry) below, `docs/research/kiwi-augment-extraction-spike.md`, and `docs/plans/2026-06-20-kiwi-augment-descriptions-design.md`.

**Grouping (set) mechanic: REMOVED on live in 26.12.** What looked on PBE like sets being partially dismantled (former set names appearing as standalone augments) was the full removal of Traits, confirmed by Riot's dev post and the live data. As of patch 26.12 (DDragon data version 16.12.1) the live ingest carries zero set membership (verified via `pnpm eval-pbe`: 0 wiki augments with sets, 0 hardcoded sets). We no longer rely on the presence-driven tolerance with live set data: `fetchWikiAugments` strips the stale wiki `set` field at the source (`sets: []`) and `getMayhemAugmentSets()` returns `[]`, so every Mayhem augment is setless and all set-coaching paths self-disable. The augment-fit, voice-query, and game-plan prompts were updated to drop set/trait reasoning. A standalone augment reusing a former set name (e.g. an `Archmage` augment) is just an ordinary augment with no set data; if its wiki entry lags, it shows the `MISSING_DESCRIPTION_PLACEHOLDER` like any other new augment.

**Offline eval harness.** `pnpm eval-pbe` (`scripts/eval-pbe-augments.ts`) diffs the live vs PBE Mayhem roster using the real ingest sources and reports added/removed/rarity-changed augments, the PBE-introduced description gap (new augments lacking wiki text), the full would-be-dropped set, and grouping signals. The diff logic is a pure, tested module: `src/lib/data-ingest/augment-patchline-report.ts`. The harness imports neither the cache layer nor localStorage, so it shares no state with the running app and is safe to run while playing. Snapshot 2026-06-07: live Mayhem 82, PBE 138; 57 new by name, 54 with no wiki description yet.

**Which patchline am I connected to?** The app currently hardcodes the live LCU lockfile path and has no patchline awareness. The connected client's patchline is readable from the LCU: `GET /riotclient/region-locale` returns `{"region":"NA",...}` on live and `"PBE"` on PBE (reachable from WSL2 when the client is running). `RiotClientInstalls.json` (`associated_client` keys) enumerates installed League products and their install dirs for multi-patchline lockfile discovery. The in-app per-patchline cache is built: `loadGameData`/`loadCachedGameData`/`fetchAndCache` take a `patchline` param (default `"live"`) and read/write under `patchlineCacheKey(patchline)` (`game-data:live` / `game-data:pbe`), so live and PBE data coexist without clobbering. Region-driven selection (detecting the connected client's patchline and passing it in) is designed (see `docs/architecture/patchline.md`) but not yet wired.

### Match-v5 and meta-build freshness

**Match-v5 has no patch filter.** You list a player's match IDs by TIME WINDOW (`startTime`/`endTime`, epoch SECONDS) and queue, not by patch. Match IDs are opaque: a match's patch (`gameVersion`) is only known after fetching its detail. So freshness in the meta-build pipeline is expressed by DATE, not patch.

**Unit trap: seconds vs milliseconds.** The Match-v5 `startTime` query param is epoch SECONDS. The match detail's `info.gameEndTimestamp` is epoch MILLISECONDS. `extractMatchData` captures `gameEndTimestamp` in ms; the collection loop converts window days to seconds for `startTime`. Mixing the two silently skews windows by 1000x.

**Legacy cached matches have no timestamp.** Match JSONL lines written before the `gameEndTimestamp` field existed load as `0` (oldest possible), which correctly excludes them from every recent window. `countMatchesInWindow` treats a missing/zero timestamp as out-of-window.

**One wide collection window per mode, ladder only at selection.** COLLECTION uses ONE wide window per mode, drained every run: `COLLECTION_WINDOW_DAYS = 30` is the default, overridden per mode by `MODE_WINDOW_DAYS` (Arena uses 60, its current 3v3 format being barely a month old and sparse). A pass lists every reachable player under `startTime = now` minus that window and fetches their in-window matches until the player queue is exhausted (snowball) or every collected match ID is fetched (ranked), with no in-window count cap, so the cached fresh bucket grows without ceiling and accumulates across runs. There is NO per-window collection target and NO widen-or-stop ladder at collection time anymore (the old `COLLECTION_TARGET = 15,000` floor and `shouldStopCollecting` are removed): an expanding collection ladder let the 7-day rung self-satisfy and skip the 14-to-30-day ring entirely, so a thin champion backfilled past never-collected recent data straight to the ancient cache. That window now always captures the recent multi-patch cushion. The selection ladder `[7, 14, 30, 60]` (`FRESHNESS_LADDER_DAYS`) is applied ONLY at SELECTION time, per champion newest-first inside `aggregateBuilds`, accumulating that champion's participants until it has `K = 40` (`CHAMPION_PARTICIPANT_TARGET`; or the ladder is exhausted, then use all available). A popular champion is built from the freshest games; a rare one backfills to a wider window instead of vanishing. `CHAMPION_PARTICIPANT_TARGET` is now the only "enough" number left in the pipeline.

**PUUIDs are encrypted per API key (the "Exception decrypting" 400).** Riot encrypts a PUUID to the API key that fetched it. A PUUID discovered with one key returns `400 Bad Request - Exception decrypting <puuid>` when queried with a DIFFERENT key. Dev keys rotate every 24 hours, so the collector's PUUID caches (`puuids-high-elo.json`, `discovered-puuids-*.json`, `queried-puuids-*.json`) go stale on every key swap, while match data (keyed by global match IDs) stays valid. `ensureKeyFingerprint()` in the script records a SHA-256 fingerprint of the key (the raw key is never stored) in `.cache/.key-fingerprint`; when it changes, only the PUUID caches are purged and match data is kept. `rateLimitedFetch` previously swallowed any non-401/403/429/5xx status as "no matches", silently grinding thousands of decrypt-400s; it now detects them (`isDecryptError` in `src/lib/meta-builds/key-cache.ts`) and aborts after `DECRYPT_ERROR_LIMIT` as a backstop. Note that high-elo PUUIDs are encrypted but otherwise well-formed 78-char strings, so format checks will not catch a poisoned cache; only the live 400 (or the fingerprint mismatch) does.

**Three-tier snowball queue (`src/lib/meta-builds/discovery-queue.ts`).** The casual-mode snowball walks players to find recent matches, but high-elo seeds are reliable ranked accounts that rarely ARAM (~7-9% have a recent ARAM game), so seeding from them and queueing every discovery behind all ~11k of them grinds hours of near-zero yield before reaching the mode-playing population. `DiscoveryQueue` drains FRONTIER -> SEED -> STALE, FIFO within each: FRONTIER holds priority seeds (e.g. `RIOT_SEED_ID`, the user's own mode account) plus every player discovered inside the freshness window this run; SEED holds the high-elo fallback seeds (entry points, not the main source); STALE holds the prior-run discovered pool (a backstop). Because discoveries go to FRONTIER, the moment a high-elo seed yields one ARAM match its co-players jump ahead of the unprocessed high-elo seeds, so the snowball locks onto the mode population after a handful of seeds. It owns dedup across all tiers (replacing the old `queueSet`), with a v1 simplification: an id already in a lower tier re-enqueued to a higher one stays put (no promotion). The cross-run `discoveredPuuids` set is unchanged: new players are still `.add`ed for the next run's stale pool and `.delete`d on query.

**Key-rotation resilience and run-cycling.** Dev keys rotate every 24 hours and each new key triggers the PUUID-cache purge, wiping the snowball's discovered-player frontier (the cascade's engine). Three pieces keep collection productive and re-runs idempotent across that:

- **Frontier-rebuild bootstrap** (`KEY_CHANGE_BOOTSTRAP_MATCHES = 300`): when `ensureKeyFingerprint` reports a key change, the snowball re-fetches its most recent in-window cached matches PURELY to recover their participants under the new key (a match ID is global, so the refetch returns valid new-key PUUIDs) and seeds them into FRONTIER. The prior-run pool was mostly unqueried, so those recovered players have uncached matches and the cascade restarts in ~10 minutes instead of limping off the few games played since the cache was built. Observed live: ~2,400 players recovered, new/query went from 0 to ~50.
- **Saturation terminator** (`SATURATION_THRESHOLD = 500`): a mode advances when 500 consecutive queries add zero new matches (genuinely caught up), not at a fixed count, which restores idempotent re-runs without capping a fresh run. Its one false-positive (a purged frontier looking saturated) is pre-empted by the bootstrap refilling FRONTIER first. Tension to know: "collect everything reachable" and "cycle modes quickly" conflict, a fresh productive cascade (queue growing, high new/query) will not saturate for hours, so ARAM drains fully before ranked/arena get a turn.
- **`--modes` flag** (`parseModesArg`, e.g. `--modes ranked-solo,arena`): restricts a run to specific queues, the practical lever to skip an already-collected mode instead of waiting for it to saturate.

**Why the old gate broke.** The previous design stopped collecting when TOTAL cached matches reached 50,000 (blind to recency) and aggregated with a HARD patch-set filter (`patchSet.has(p)`). Against a cache full of old-patch matches, a re-run fetched zero new matches and aggregation produced `champions: {}`. The date-window model fixes both: the gate counts only in-window matches, and selection never hard-drops a champion for being on a slightly older patch.

**Pure logic lives in `src/lib/meta-builds/aggregation.ts`** (side-effect free, no `Date.now()` inside: callers pass `nowMs`/cutoffs at the boundary). The script `scripts/fetch-meta-builds.ts` owns the I/O loops and imports the types and helpers. Output adds `targetPatch` (newest major.minor from DDragon `versions.json`, element 0) and `freshPatchShare` (fraction of used participants on `targetPatch`) at both the top level and per champion, plus `windowDaysUsed` per champion. The legacy `patch` field is kept equal to `targetPatch` so existing consumers do not break.

### Loading meta-build JSON in the app (`import.meta.glob`)

The app loads `src/data/meta-builds/*.json` through Vite's `import.meta.glob` (`loadMetaBuilds` in `src/lib/data-ingest/meta-builds.ts`). Two non-obvious facts caused a silent production regression:

- **Only the CALL form of `import.meta.glob` is rewritten.** Vite replaces `import.meta.glob("...")` at build time with a static map of lazy importers, but it does NOT define `import.meta.glob` as a runtime value. A bare reference (`import.meta.glob` without calling it) is therefore `undefined` at runtime in the bundled renderer too, not just under tsx/Node. So `typeof import.meta.glob !== "function"` is ALWAYS true and is the wrong way to feature-detect: it silently strips meta builds from production coaching prompts while still working under tsx. Guard by wrapping the actual call in `try/catch` instead (tsx throws "import.meta.glob is not a function"; the renderer never reaches the catch).
- **Vitest reproduces the call transform but not the absent-bare-reference behavior**, so a plain `loadMetaBuilds()` integration test cannot drive this regression red. `loadMetaBuilds` takes an optional injected module map (`modulesOverride`) purely as a test seam to exercise the load and degrade branches deterministically.
- **Symptom signature:** when meta builds fail to load, the coaching system prompt's base-context loses the per-champion "Item pool" tier-1 section (~2,300 chars). Visible in logs as the `[game-plan] ask: ... base=NNNN` number dropping from ~5k to ~2.7k.

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

## AI Recommendation Engine

### Architecture (per-feature, post-#108)

The AI module (`src/lib/ai/`) is organized into per-feature modules under `src/lib/ai/features/`:

- `features/augment-fit/` — independent fit ratings for offered augments
- `features/game-plan/` — 6-item build path with categories and reasons
- `features/item-rec/` — item purchase recommendations with destination + component format
- `features/voice-query/` — open-ended voice queries

Each feature directory exports a `CoachingFeature<TInput, TOutput>` (interface in `feature.ts`) with its own task prompt, user-message builder, output schema (with field-level enums where structural correctness matters — see #109), result extractor, and prose history summarizer. Game-plan is a _factory_ (`createGamePlanFeature(gameData)`) because its schema enum-locks `buildPath[].name` to the player's actual item catalog.

The `MatchSession` (`src/lib/ai/match-session.ts`) is the dispatch boundary. Production callers (`CoachingPipeline.tsx`) and the eval harness both go through `session.ask(feature, input)`. The session:

- composes the system prompt as `buildBaseContext(...) + feature.buildTaskPrompt(input) + personality.suffix()`
- pushes the feature's user message onto `messages[]` (cumulative across the match)
- delegates LLM dispatch to `runFeatureCall` (race-with-retry, abort propagation, optional injected model for the eval harness)
- appends the assistant turn as **prose** via `feature.summarizeForHistory(result)` (heterogeneous structured outputs collapse to homogeneous prose history)
- enforces `feature.supportedPhases` — calling `ask()` with a feature that doesn't support the current phase throws

### Key design decisions

- **`buildBaseContext` is feature-agnostic** — coaching persona, item awareness rules, gold awareness, conversation format, mode, champion profile, item catalog, match roster. Anything that's per-feature (response style, augment-fit rules, item-rec format) lives in the feature's task prompt.
- **Personality is a suffix layer** — `briefPersonality` (default) carries the brevity / lead-with-recommendation rules previously baked into `buildBaseContext`. `noopPersonality` exists as a structural fallback; future personalities (#24) replace `briefPersonality` cleanly.
- **History stores prose summaries, not structured JSON** — `feature.summarizeForHistory(result)` returns the `.answer` string for most features, or a synthesized prose summary (e.g. `"Augment ratings: X [exceptional], Y [strong]"` for augment-fit). Keeps multi-turn history homogeneous regardless of which features fired earlier.
- **Settings persistence via Electron IPC + JSON file** — renderer's `localStorage` didn't survive launches in the ow-electron setup. Settings (e.g. selected personality) round-trip through `settings:get` / `settings:set` IPC handlers that read/write `<userData>/settings.json`.
- **Balance overrides are formatted as human-readable text** for the LLM (e.g., "Damage taken: -5%"), not raw multipliers (0.95).
- **API key is via Vite env var** — `VITE_OPENAI_API_KEY` in `.env` for production, `EVAL_OPENROUTER_API_KEY` for eval (separate billing).
- **`recommendation-engine.ts` accepts an injected `model`** — production uses `createCoachingModel(apiKey)`; the eval harness injects an OpenRouter-backed model. Same code path, different provider — the eval and the app exercise identical wiring.

### Model selection

GPT-5.4 Mini was selected via PickAI discovery (see `scripts/discover-candidates.ts`). Selected for cost/speed balance suitable for real-time coaching during gameplay.

### Eval pipeline — OpenRouter support

The eval pipeline (`src/lib/ai/coaching.eval.ts`) supports both OpenAI direct and OpenRouter as providers. Key details:

- **Env vars:** `VITE_OPENAI_API_KEY` / `OPENAI_API_KEY` for OpenAI direct, `VITE_OPENROUTER_API_KEY` / `OPENROUTER_API_KEY` for OpenRouter. At least one must be set.
- **API compatibility:** AI SDK 5 (`@ai-sdk/openai` v3+) defaults to the OpenAI Responses API, which OpenRouter doesn't support. Use `.chat()` (e.g., `openrouter.chat(modelId)`) to force the Chat Completions API when routing through OpenRouter.
- **Model IDs:** OpenRouter requires the `provider/model` format (e.g., `openai/gpt-5.4-mini`), while OpenAI direct uses just the model name (e.g., `gpt-5.4-mini`).

### Eval scorer patterns

- **Gate scorers** return 0 or 1 (pass/fail). Used for non-negotiable requirements (item awareness, structured output, state awareness, gold-aware format). The augment re-roll accuracy gate scorer was removed when augment coaching switched from prescriptive ranking to independent fit ratings (#101).
- **Ranking scorers** return 0-1 on a scale. Used for quality metrics (brevity, decisiveness, continuity, gold awareness, pivot explanation).
- **`scorerHints`** — per-fixture metadata that tells scorers what to check. Added to `MultiTurnFixture` and `EvalInput`. Prevents false positives by only checking rules relevant to each fixture's scenario.
- **State Awareness** scorer checks for keyword presence (GW items, MR items, enemy champion names, damage profile terms, owned items). All declared rules must pass for score=1.
- **Pivot Explanation** scorer uses a hybrid approach: rule-based pivot detection (does the response still mention the prior recommendation?) + pattern matching for causal language (because, since, now that, etc.). When the prior item is mentioned alongside causal language, it's treated as a dismissal rather than a recommendation.
- **Gold-Aware Recommendations** scorer gates on response content (purchase verbs like "buy", "build toward", "rush", "get a"), not question text. If the response contains a purchase verb, it must follow the destination+component format. Augment confirmations ("I chose X") and augment offers ("X, Y, or Z") are excluded — the model may mention items incidentally in those contexts. This approach eliminates false positives from strategy questions that happen to contain words like "next" or "build".
- **Item recommendation format** lives in `features/item-rec/prompt.ts`: "When recommending an item purchase, always name the destination item AND a buildable component." Non-purchase paths (`features/voice-query/prompt.ts`) explicitly tell the LLM NOT to force the format. This means voice-query item-purchase questions currently get casual recommendations that fail the `Gold-Aware Recommendations` scorer — see #113 for the routing fix and #115 for the scorer's variance characterization.
- **Augment data in state snapshots** — `PlayerSnapshot.augments` is an array of `{name, description, sets}`, not just names. `GameSnapshot.augmentSetProgress` shows active bonuses and next thresholds. Both are computed in `takeGameSnapshot()` from `LoadedGameData`. The `formatAugmentOfferLines()` helper (in `augment-offer-formatter.ts`) adds set bonus unlock previews when the model is choosing augments.
- **SYNERGY COACHING** instruction lives in `features/augment-fit/prompt.ts` (ARAM Mayhem only) and tells the model to look for augment/set bonus/item/stat anvil synergies and recommend unconventional builds when synergies warrant it.

### OpenAI structured outputs — strict-mode schema rules

OpenAI's Responses API with structured outputs enforces rules beyond standard JSON Schema. These are silent until the API rejects the call at runtime, which can cascade: the coaching response schema is shared across every LLM call (augment coaching, voice, game plan), so one invalid property breaks all of them.

- **Every declared property must appear in `required`** at every nesting level, including optional ones. There is no "optional-by-omission" as in draft-07 JSON Schema.
- **Optional fields must be nullable.** Use `type: ["string", "null"]` (or `["array", "null"]`, etc.) and list the property in `required`. The model then returns `null` instead of omitting the field. **Example:** `CoachingResponse.buildPath[*].targetEnemy` is the counter-target enemy name for `counter` items and `null` for every other category — the field is always present on every build-path item. Any prompt wording that tells the model to "omit" such a field should instead tell it to "set to `null`"; the structured-output machinery will force the key to be present regardless, so "omit" instructions only confuse the model.
- **`additionalProperties: false` is required** on every object node.
- **Error signature:** `Invalid schema for response_format 'response': In context=(...), 'required' is required to be supplied and to be an array including every key in properties. Missing '<field>'.`
- **Local guard:** `src/lib/ai/schemas.test.ts` walks the schema tree and asserts `required` completeness + `additionalProperties: false` at every level. Runs offline; catches violations before they hit the API.
- **Consequence for TS types:** prefer `field: T | null` over `field?: T` when the field is part of an AI-SDK response schema, to keep the TS type honest about what the model returns.

### Cross-element array constraints belong in prompt + post-call validator

OpenAI strict structured outputs disallow the JSON Schema keywords that would express uniqueness-by-predicate: `contains`, `maxContains`, and `uniqueItems` are all outside the strict-mode subset. Enums, `required`, `additionalProperties`, and the array-length keywords (`minItems`/`maxItems`) are in — the game plan's `buildPath` schema uses `minItems: 6` / `maxItems: 6` to pin the array length. Consequence: any rule of the form "at most N elements of the array satisfy predicate P" cannot be enforced structurally.

- **Example (#109):** the game plan's 6-item `buildPath` must contain at most one Boots-tagged item. The `name` enum restricts each element to a valid catalog entry but allows multiple boots (each pair is individually valid). The rule lives in `GAME_PLAN_TASK_PROMPT` as a sentence and is double-checked after the call by `findDuplicateBoots` in `src/lib/ai/features/game-plan/index.ts`, which reads item tags from `gameData.items` and returns the offending entries when 2+ are present. The pipeline logs a warn; it does not rewrite. Two-pass "detect + log" is the observability baseline; remediation (retry, drop, replace) is a feature choice per rule.
- **Eval coverage:** `Boots Uniqueness` gate scorer in `coaching.eval.ts` wraps `findDuplicateBoots` so model-comparison runs surface the violation rate alongside other hard-correctness gates.
- **When to reach for this pattern:** any constraint that relates multiple elements of a structured-output array to each other or to external data (catalogs, the player's current inventory, roster membership, etc.). The schema's job ends at "each element is individually valid."

### Game plan prompt is state-agnostic

`buildGamePlanQuestion()` in `src/lib/ai/game-plan-query.ts` is deliberately free of temporal anchors ("start of the game", "mid-game", etc.). The `[Game State]` block preceding every message carries all temporal context (current items, game time, enemy itemization, augments picked, KDA), so one prompt drives both the auto-fired opening plan and the mid-game "Update Game Plan" voice command. Adding phase-specific wording introduces contradictions when the state snapshot disagrees with the prompt (observed: "This is the start of the game" while state showed `t=18:42`, 4 items built — model hedged or re-reasoned from scratch).

### GEP replays stale augment events at app launch

When champ-sage attaches to an already-running League game, Overwolf's GEP replays the most recent augment pick and the offer that preceded it — in that order, ~50ms apart. Without filtering, this triggers auto-coaching and leaves the overlay's "Analyzing" badges stuck for up to the 25s timeout (and a follow-up LLM call that wastes tokens).

- **Filter:** `electron/gep-replay-filter.ts` tracks names of augments picked in the current game and suppresses any subsequent offer containing an already-picked augment. Runs in the main process so both the main window and the overlay window (which listen to raw `gep-info-update` IPC independently) are protected from a single point.
- **Reset:** `augmentReplayFilter.reset()` fires on GEP `game-exit` so the next match starts clean.
- **Assumption:** in ARAM Mayhem / Arena, an augment cannot be picked twice, so current-offer vs. prior-pick overlap is always a replay. If a future mode permits re-picking, the filter needs a time-bounded variant.
- **Overlay is a separate renderer:** the overlay window (`src/overlay/OverlayApp.tsx`) parses GEP info updates directly via `window.electronAPI.onGepInfoUpdate`, not through the main-window `augmentOffer$` Subject. Filtering has to live at the broadcast boundary in `electron/main.ts` to affect both windows.

### GEP package resolution: the 0.0.0 outage and the version floor

GEP is not an npm package. ow-electron downloads it at runtime via OWEPM (Overwolf Electron Package Manager): it fetches a version manifest from `https://electronapi.overwolf.com/packages`, then pulls each package binary from the CDN at `https://electrondl.overwolf.com/<channel>/<version>/module.owepk`. Channels are stable per package: `gep=1`, `utility=2`, `overlay=3`. The `overwolf.packages` array in `package.json` declares which packages to resolve. This is the canonical, latest setup (matches `overwolf/ow-electron-packages-sample`); there is no different/newer install.

Four distinct Overwolf-side failures can silently kill augment coaching while everything LCU-sourced (enemy list, your items, gold, item recs) keeps working, because those ride Live Client Data / LCU polling, not GEP:

- **Manifest outage (0.0.0 stubs):** when Overwolf's manifest API regresses it reports `version: "0.0.0"` and a `…/0/0.0.0/<pkg>.owepk` URL for every package (first seen 2026-05-29, still ongoing 2026-06-06; all `?channel=N` params return the same). OWEPM then downloads a ~21 KB non-functional GEP stub instead of the real ~19 MB module. `manifestIndicatesOutage` keys off `gep.version === "0.0.0"`.
- **Version floor (the subtle one):** League raises GEP's minimum-compatible version on roughly every patch. When the game launches, if the loaded GEP is below that floor, GEP's runtime log shows `Detected GEP Version X is lower than the minimum allowed version: Y` followed by `game status is disabled, not starting handler for game`. The in-game handler never starts, so `game-detected` never reaches the app (`setRequiredFeatures(["augments"])` never runs) and the `augments` feature never emits. Symptom is identical to a total GEP failure but the package loaded fine; only the game-attach was rejected. (Observed: a pinned `305.1.3` worked on Jun 1, then League patched and the floor moved to `306.0.2`, so the same cached build was rejected on Jun 5.)
- **Recovered manifest, stub binary (the 2026-06-13 case):** the manifest API can stop reporting `0.0.0` and report a real version (observed `gep 306.0.10`, with the real ~19 MB binary genuinely hosted on the CDN) while OWEPM still holds a ~21 KB stub `.owepk` on disk from the outage window. `manifestIndicatesOutage` then reads healthy and the old guard stepped aside, yet the loaded GEP is `v0.0.0`, never attaches, and `setRequiredFeatures(["augments"])` never confirms. The manifest's version field is NOT proof the cached binary is real. Detect by size: a `.owepk` under ~1 MB is a stub (real is ~19 MB), regardless of the version string. Tell from the game log: `Overwolf package ready: gep v0.0.0` plus the absence of any `Required features set` line.
- **Discovery-window blind spot (the 2026-06-27 case):** after the manifest recovered, the served GEP froze at the newest build _bare CDN discovery could reach_ (`306.0.10`, real and downloadable) while League advanced its bundled GEP to `307.4.6`, so the floor rejected the cached build. `discoverLatestVersion` walks upward from the hardcoded baseline `{306,0,0}` with `minorLookahead=2, majorLookahead=1`, so it only probes the `306.0.x / 306.1.x / 306.2.x / 307.0.x` lines. Overwolf skipped the `307.0.x` line entirely (every `307.0.x` returns 403) and shipped `307.1.1 → 307.4.6`, so discovery could not see `307.4.x` and settled on `306.0.10`. The tell is a divergence in `.ow-guard.log`: `--check` read the recovered manifest and _reported_ `serving override to the newest real GEP build [307.4.6]` while `--serve` actually built `gep@306.0.10` (`local package cache already matches the override; nothing to purge`), so the cache never advanced. In the game log, `Overwolf package ready: gep v306.0.10` with no `League detected` / `Required features set` lines (the overlay package still fires its own `Game launched` because it is version-gated separately). Fix: `resolveGepVersion` seeds from the recovered manifest's advertised GEP version, verified downloadable with a CDN probe, and `--check`/`--serve` share it so the reported and served versions can no longer diverge.

The guard (`scripts/ow-package-guard.ts`, fed to ow-electron via the supported `--owepm-packages-url` flag) forces ow-electron onto the newest real served build by serving the override on EVERY launch a live build is resolvable, not just when the cache looks stale (`decideGuardAction` returns `override-needed` whenever a latest version is found, `cannot-resolve` otherwise). This is required because OWEPM re-resolves GEP against Overwolf's manifest each launch and re-downloads the ~21 KB stub over a known-good cached binary whenever the override is absent (observed 2026-06-13: a second app instance saw a real `306.0.10` cache, stood down, and OWEPM clobbered it back to a stub). Both `--check` (`runCheck`) and `--serve` (`buildOverrideManifest`) resolve GEP through a single helper, `resolveGepVersion`, so the version the guard reports and the version it serves can never diverge: it returns the recovered manifest's advertised GEP version when a CDN probe confirms that exact build is downloadable, and falls back to baseline CDN discovery only during the `0.0.0` outage, when the manifest is unreachable, or when the advertised build is not yet on the CDN. `--serve` then purges any cached GEP whose version differs OR whose `.owepk` is a stub, so OWEPM re-downloads the real binary. The manifest seed matters because bare discovery cannot reach a new (major, minor) line beyond its lookahead window once the intervening line is rotated to 403 (the 2026-06-27 blind spot above): trusting the recovered manifest tracks League's floor without a hand-maintained baseline. Pinning an absolute version is a treadmill: it goes stale on every floor bump, and Overwolf rotates old builds off the CDN (older versions return `403 AccessDenied`; only the most recent few are live), which is why discovery probes upward (no listing or `latest` alias exists; ranged `GET bytes=0-0` returns 200/206 live vs 403 rotated). The discovery baseline remains the outage-only fallback floor, so if Overwolf's manifest API regresses to `0.0.0` again while League's floor sits above the discoverable `306.x` range, that baseline still needs a periodic bump. Overlay/utility stay on compat-stable pins that self-heal only if rotated off the CDN. Because the trigger is now cache-vs-served rather than the outage signature, the guard stays correct whether or not Overwolf's manifest API has recovered.

- **Diagnosing:** ow-electron's own logs live under `%APPDATA%/ow-electron/<appHash>/logs/` (WSL: `/mnt/c/Users/<user>/AppData/Roaming/ow-electron/<appHash>/logs/`). `owpm.log` shows package resolution (`LocalStorage package discoverer` = loaded from cache); `gep/gep.log` shows the runtime, including the `minimum allowed version` rejection and the live `"featureName":"augments"` info updates when it is working.

### GEP health banner and the restart-to-update flow

A loaded GEP can be silently rejected at game-attach when it is below League's version floor (or a 0.0.0 stub), and no GEP/OWEPM event fires for that rejection. Health is therefore PREDICTED before a game from two signals: the loaded GEP version (the `packages.on("ready")` event in `electron/main.ts`) and the floor, which Overwolf publishes on a public, no-auth endpoint SEPARATE from the package manifest: `https://game-events-status.overwolf.com/<gameId>_prod.json` (League = 5426), field `min_gep_version_electron` (prefer it over the native `min_gep_version`; they can differ, e.g. Dota). Because it is a separate service it stays readable during a manifest outage. The pure logic lives in `src/lib/gep-health.ts` (`fetchGepFloor`, `evaluateGepHealth`, `parseVersion`), shared by the guard CLI, main, and the renderer.

- **Verdict + banner:** `evaluateGepHealth` returns red (loaded `0.0.0`, a stub, or below floor), warn (Overwolf reports the augments feature degraded), or green. Main emits it on the `gep-health` IPC, caches it for a `gep:get-health` pull (the `ready` event can fire before the renderer subscribes), and re-checks every 5 minutes so a patch that raises the floor mid-session surfaces. The desktop window renders a red verdict as an "Update required" banner with a "Restart now" button (`src/components/GepHealthBanner.tsx`, `useGepHealth`); warn is an informational note; green renders nothing. Settings > About shows the live loaded GEP version.
- **Restart-to-update (works under `pnpm dev:electron`):** GEP cannot be hot-reloaded, so a floor-clearing build only loads on a fresh launch. "Restart now" calls `app.exit(42)`. `scripts/launch-electron.sh` runs a relaunch LOOP: on exit code 42 it re-runs the guard (re-resolving the latest, purging the stale cache) and restarts ow-electron in place. A plain `app.relaunch()` cannot be used: it would exit the launcher and let `concurrently -k` tear Vite down, leaving the relaunched app with no renderer. `exit $LASTEXITCODE` propagates ow-electron's code out of powershell.exe so the loop can read it. Verified live 2026-06-28: a forced 306.0.10 upgraded to 307.4.7 across one button press.
- **TTL re-resolve:** the override server (`createCachedResolver`, 15s TTL) re-resolves per request rather than once at startup, so a relaunch fetches a build newer than the one resolved at the first launch.
- **Test hooks (inert unless set):** `GEP_FORCE_VERSION=<ver>` pins the override to a specific CDN-live build so a stale-GEP restart can be exercised on demand (the launcher unsets it after the first launch so the relaunch resolves the real latest); `pnpm ow-guard --healthcheck` prints the pre-game verdict and exit code; `OWEPM_OVERRIDE_DISABLE=1` skips the guard for the native-resolution live test.

Full background, the floor-endpoint discovery, and the rejected alternatives: `docs/research/gep-version-drift-recommendation.md`.

### Coach decision log — synthetic gameId for in-game records

Phase 5a's persistent coach decision log records every `coaching-response` IPC payload. Persistence happens passively in main: the existing `coaching-response` handler taps off into `coachDecisionLog.append(...)` after the overlay relay, so emitters in the renderer never reach for a writer.

- **Synthetic session id:** the Live Client Data API only exposes `gameId` via `eogStats` at end-of-game. For in-game writes the renderer (`CoachingPipeline.tsx`) generates a per-game `gameSessionIdRef` (UUID) when the session-create effect fires and reuses it on every overlay payload as `gameId`. The real Riot `gameId` (when available via eogStats) is not used — correlating the synthetic id to it would be a future enhancement.
- **Reset coupling:** the gameSessionIdRef resets alongside `gamePlanRevRef` and `gamePlanFiredRef` in the same effect, so a new game starts with a fresh id, fresh rev counter, and fresh plan-fired latch atomically.
- **Storage layout:** `<userData>/decision-log/<gameId>.ndjson` per-game files plus a sibling `index.json` listing games chronologically. The index is rebuilt from existing `.ndjson` files if missing or unparseable, so deleting it forces a clean re-scan without touching record data.
- **Recovery:** corrupt lines (process killed mid-write, or an external edit) are dropped on hydrate and surfaced via `log.warnings()`. Main logs the count; the app keeps running with the longest valid prefix.
- **Failure isolation:** an `append` failure never blocks the overlay relay. Main catches the rejection, warns via electron-log, and moves on. The overlay still renders the response.
- **Module split:** record types and the pure `summarizeGame` helper live in `src/lib/decision-log/` so renderer-side consumers (post-game takeaways, idle recap) can import them without crossing into Electron-only code. The storage adapter, log factory, and payload→input mapper live in `electron/decision-log/` (Node fs imports, main-process only).

### SWR scoped cache provider — global `mutate` misses it

`<SWRConfig value={{ provider }}>` creates a _scoped_ cache. The package-level `mutate` exported from `swr` only operates on SWR's _default_ (unscoped) cache, so calling it does nothing visible when a custom provider is in play — the fetch never fires, the hook never revalidates, and there is no error.

- **Symptom:** an invalidation trigger runs (logs confirm it), but the `useSWR` consumer never re-fetches.
- **Fix:** the provider-scoped mutator is only reachable via `useSWRConfig().mutate` _inside_ the `<SWRConfig>` subtree. Non-React engine code (RxJS store subscriptions) can't call a hook, so `src/lib/cache/swr-bridge.ts` holds a module-level ref: a tiny `<SWRBridge />` component calls `setScopedMutate(useSWRConfig().mutate)` in an effect, and engine code calls `invalidateKey(...)`. Invalidations issued before the bridge mounts are queued and drained on registration.
- **React Fast Refresh caveat:** HMR can hot-swap a component's definition without the new JSX ever entering the live tree, so a freshly-added `<SWRBridge />` may not actually render until a full reload. Dev-only; a hard refresh fixes it. Production mounts the tree once and is unaffected.

### SWR side effects: fetcher body runs before the cache commits

A side effect placed at the end of a `useSWR` fetcher runs _before_ SWR writes the resolved value into its cache. Anything that reads the cache immediately after (a readiness gate, another hook) sees stale data.

- **Observed (#129):** `markMatchesRefreshed()` called inside `fetchMatches` flipped a "data is ready" gate while `useMatchHistory().matches` still held the previous fetch — the post-game surface revealed with the prior game's match row.
- **Fix:** move the side effect to SWR's `onSuccess` config callback. `onSuccess` fires _after_ the cache is committed, so every consumer reading the cache in the render that follows sees the new value.

### LCU lockfile appears seconds before the HTTPS server binds

The LCU lockfile (and thus credentials) becomes readable several seconds before the LCU's HTTPS server actually accepts connections. A fetch fired on credentials-available reliably fails with `ECONNREFUSED`.

- **Wrong trigger:** `lcuCredentials$` (fires on lockfile discovery).
- **Right trigger:** `lcuReady$` in `src/lib/reactive/streams.ts` — set `true` only once the engine's LCU WebSocket has connected, which is the same moment HTTP requests start succeeding. Match-history fetches key off this. Using it removed ~14s of retry-backoff slack that the old credentials-triggered path paid on every game launch.

### Post-game surface must hide on the phase transition, not on `activePlayer` clearing

When a game ends, the gameflow phase moves to `WaitingForStats`/`PreEndOfGame`/`EndOfGame` — and `resolveSurface` auto-routes to the post-game surface on that signal. `liveGameState.activePlayer` clears separately, ~500ms+ later.

- **Consequence:** a hide gate keyed off `activePlayer` clearing engages _after_ the surface has already mounted and rendered cached (previous-game) data — a visible flash.
- **Fix:** `post-game-readiness.ts` flips `postGameReady$` to `false` on the phase transition into a post-game phase (subscribed via `wirePostGameReadiness`), so the surface mounts already gated. It flips back to `true` only once _both_ the in-memory snapshot and the match-history fetch are fresh for the just-ended game; a 15s failsafe forces reveal if a signal never lands.
- **Display must be pinned to the snapshot's gameId:** `PostGameSurface` scopes its records filter and match-history row lookup to `snapshot.gameId`. When `focusGameId` is known, never substitute another game's match row (e.g. `recentGames(1)[0]`) — return `undefined` and let `mergeMeta` fall back to the takeaway/snapshot champion, which is the same game.

### Main window bounds persistence and the mixed-DPI restore trap

The main desktop window (`createMainWindow` in `electron/main.ts`) persists its position and size to `settings.json` (key `mainWindowBounds`) on every resting move/resize and restores them on launch, so it reopens where the user last left it. The strip overlay and the main window now share one factory, `createBoundsStore(io, key)` in `electron/bounds-store.ts`; `strip-bounds-store.ts` is a thin binding over it.

- **The trap (mixed-DPI multi-monitor):** passing saved `x/y/width/height` to the `BrowserWindow` constructor sizes the window with the _primary_ display's scale factor. When the target bounds live on a secondary monitor at a different scale (observed: primary 2560x1440 @ 1.0, secondary 2195x1235 @ 1.75), the constructor does not rescale once the window lands on the secondary, so the window comes out the wrong size and its right edge clips off-screen.
- **Fix:** construct the window, then call `win.setBounds(saved)`. setBounds runs after the window is placed on its target display, so position and size both resolve in that display's DPI. Pair it with `show: false` plus show on `ready-to-show` so the corrected bounds apply before first paint (no flash, no monitor jump).
- **Off-screen safety:** on restore, `boundsAreVisible` (`electron/window-placement.ts`) requires the saved rect to overlap some connected display's work area by at least 64px on each axis; otherwise it falls back to the default centered placement, so a window saved on a now-absent monitor never opens unreachable.
- **Do not persist the restore:** the programmatic `setBounds` fires a resize event. Attach the move/resize persistence listeners only inside the `ready-to-show` handler so the restore is not written back as a user action. At fractional scale (1.75) the save/restore round trip can drift the stored size by ~1px before it stabilizes; that is rounding, not a leak.
