## Game History Persistence — Decision Record

### Problem explored

Whether persisting game session data to SQLite is worth building, given the app's core value is real-time AI coaching with live game context.

### Original motivation

Personal memory: "Did I try this build before? Did it work?" — wanting the coach to reference past games when making recommendations.

### Key insight

The coaching scenarios that history would enable (e.g., "last time you built X against Y it didn't work") can be handled through **first-principles reasoning** by the AI. A good LLM with the current game state — your champion, items, enemy team comp, ARAM overrides — can already recommend the right build without needing to know what you did last game. History adds a personal touch but doesn't provide information the AI can't derive from game knowledge.

### What history COULD uniquely provide

Personal build archetype win rates ("you do better on mage Seraphine than enchanter Seraphine"). But this requires classifying item sets into build archetypes across many games — complex to do well and unclear product value for the POC.

### Decision

**Drop game history persistence (#7) from the POC.** The real-time coaching use case is fully served by first-principles AI reasoning with live game data. History can be revisited post-POC if real usage reveals a gap that first-principles coaching can't fill.

### Impact

- Issue #7 (game session persistence) — deprioritized, moved out of POC
- Issue #20 (cross-game memory) — also deprioritized since it depends on #7
- The LCU integration work (lockfile discovery, end-of-game stats) is still valuable for **game lifecycle management** — detecting game start/end, capturing win/loss for display — even without persisting to a database
