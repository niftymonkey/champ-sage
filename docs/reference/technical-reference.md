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

### Game mode internal names

| Display name    | Live Client Data API `gameMode` | LCU `gameMode` | Constant           |
| --------------- | ------------------------------- | -------------- | ------------------ |
| ARAM Mayhem     | `KIWI`                          | `KIWI`         | `GAME_MODE_MAYHEM` |
| Regular ARAM    | `ARAM` (assumed, untested)      | `ARAM`         | `GAME_MODE_ARAM`   |
| Summoner's Rift | `CLASSIC`                       | `CLASSIC`      | —                  |
| Arena           | `CHERRY`                        | `CHERRY`       | `GAME_MODE_ARENA`  |

Both sources return the same mode string for all tested modes. Regular ARAM has not been tested in-game yet — the `GAME_MODE_ARAM` ("ARAM") value is assumed from documentation and used as a fallback in mode detection. ARAM Mayhem consistently returns "KIWI" (tested patch 15.6). Constants are defined in `src/lib/mode/types.ts`.

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

## AI Recommendation Engine

### Architecture

The AI module (`src/lib/ai/`) uses Vercel AI SDK v6 with OpenAI's GPT-5.4 Mini for augment recommendations. Pattern: `generateText` with `Output.object` for structured JSON output via `jsonSchema`.

### Key design decisions

- **Context assembly is a pure function** — `assembleContext()` transforms `LiveGameState` + `LoadedGameData` into a flat `CoachingContext` suitable for LLM consumption. No side effects, fully testable.
- **Prompt construction is pure** — `buildSystemPrompt()` and `buildUserPrompt()` are deterministic given inputs. Tested via string containment assertions.
- **The recommendation engine is NOT unit tested** — it calls a real LLM. Only the pure functions around it are tested.
- **Balance overrides are formatted as human-readable text** for the LLM (e.g., "Damage taken: -5%"), not raw multipliers (0.95).
- **API key is via Vite env var** — `VITE_OPENAI_API_KEY` in `.env`, following the existing pattern for client-side env vars in Tauri apps.

### Model selection

GPT-5.4 Mini was selected via PickAI discovery (see `scripts/discover-candidates.ts`). Selected for cost/speed balance suitable for real-time coaching during gameplay.

### Eval pipeline — OpenRouter support

The eval pipeline (`src/lib/ai/coaching.eval.ts`) supports both OpenAI direct and OpenRouter as providers. Key details:

- **Env vars:** `VITE_OPENAI_API_KEY` / `OPENAI_API_KEY` for OpenAI direct, `VITE_OPENROUTER_API_KEY` / `OPENROUTER_API_KEY` for OpenRouter. At least one must be set.
- **API compatibility:** AI SDK 5 (`@ai-sdk/openai` v3+) defaults to the OpenAI Responses API, which OpenRouter doesn't support. Use `.chat()` (e.g., `openrouter.chat(modelId)`) to force the Chat Completions API when routing through OpenRouter.
- **Model IDs:** OpenRouter requires the `provider/model` format (e.g., `openai/gpt-5.4-mini`), while OpenAI direct uses just the model name (e.g., `gpt-5.4-mini`).

### Eval scorer patterns

- **Gate scorers** return 0 or 1 (pass/fail). Used for non-negotiable requirements (item awareness, structured output, augment re-roll mechanics, state awareness, gold-aware format).
- **Ranking scorers** return 0-1 on a scale. Used for quality metrics (brevity, decisiveness, continuity, gold awareness, pivot explanation).
- **`scorerHints`** — per-fixture metadata that tells scorers what to check. Added to `MultiTurnFixture` and `EvalInput`. Prevents false positives by only checking rules relevant to each fixture's scenario.
- **State Awareness** scorer checks for keyword presence (GW items, MR items, enemy champion names, damage profile terms, owned items). All declared rules must pass for score=1.
- **Pivot Explanation** scorer uses a hybrid approach: rule-based pivot detection (does the response still mention the prior recommendation?) + pattern matching for causal language (because, since, now that, etc.). When the prior item is mentioned alongside causal language, it's treated as a dismissal rather than a recommendation.
- **Gold-Aware Recommendations** scorer checks format compliance (destination + component pattern), not item correctness. Uses regex for "build toward" and component verb patterns. Returns 1 if neither pattern matches (response may not be an item recommendation).
- **Item recommendation format** in system prompt: "Build toward [destination]. You can get a [component] now/at [gold]g." Destination item always leads. Name the most expensive affordable component.
