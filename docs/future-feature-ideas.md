# Future Feature Ideas

Potential features discovered during development conversations. Not committed to — just ideas worth remembering.

## Proactive Coaching (SR-focused)

These require the reactive architecture (#33) and Summoner's Rift game data:

- **Objective timers** — "Dragon spawning in 30 seconds, start positioning." Derive from game time + objective spawn intervals.
- **Death window awareness** — "Their jungler is dead for 20 seconds, this is your window for dragon." Uses `respawnTimer` from the Live Client Data API.
- **Gold reminder** — "You have 3000 gold and haven't backed. Consider buying." Uses `currentGold` from active player data.
- **Build path adjustment** — "Enemy team is all AD and you have no armor items." Uses enemy team items + your items from the Live Client Data API.
- **Skill order coaching** — "You maxed Q first but E max is stronger against their comp." Uses ability levels from the Live Client Data API.
- **Map terrain awareness** — "The map is Infernal terrain, watch the brush changes." Uses `mapTerrain` from game data.

## Social / Quality of Life

- **Friend message notifications via TTS** — "niftymonkey says: want to play after this?" Uses `/lol-chat/v1/conversations` and `/lol-game-client-chat/v1/instant-messages` from the LCU WebSocket. Read messages through TTS so the player doesn't have to alt-tab.
- **Patch available notification** — "A new patch is available." Uses `/patcher/v1/products/league_of_legends/state` from the LCU WebSocket.

## Mode-Specific

- **ARAM reroll coaching** — "You have 2 rerolls and your champion has a low ARAM win rate. Consider rerolling." Uses reroll data from LCU + champion performance data.
- **Arena round awareness** — Round transitions, opponent tracking across rounds.
- **Champ select coaching** — During champ select, suggest bench swaps in ARAM or trade recommendations based on team comp. Uses `/lol-champ-select/v1/session` from LCU WebSocket.
