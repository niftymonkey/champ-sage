# Champ Sage: Product Vision

## What It Is

Champ Sage is a real-time coaching companion for League of Legends that watches your game and helps you make better decisions, without being asked. It understands your champion, your build, your team, the enemy team, and the decisions you've already made, and surfaces informed options with reasoning at each decision point.

## The Gap It Fills

Every existing companion app (Porofessor, Mobalytics, U.GG, OP.GG, Blitz, Facecheck) answers the same question: "what's statistically best in general?" They provide pre-computed builds, tier lists, and win rates aggregated from millions of games.

None of them answer: "what's best for you, right now, in this specific game state?" That's the difference between a reference tool and a coach.

## Two-Layer Interaction Model

### Proactive Layer (primary)

The app continuously monitors game state and surfaces recommendations at decision points and when it observes something worth commenting on.

**Decision point advice**, triggered by game events:

- Champ select: team comp analysis, swap suggestions
- Augment picks: contextual recommendation with re-roll guidance
- Item purchases: what to buy next, updated as gold and game state change
- Stat anvils: prioritized stat optimization (3 choices, no re-rolls, similar to augment picks but simpler)

**Passive observations**, triggered by patterns the system detects:

- "You've died to Viego 3 times, consider building armor next back"
- "Enemy team is all AP, prioritize MR"
- "You have 2000 gold and haven't bought anything"

> **Design constraint (Riot compliance):** Passive observations must stay within the boundary of **build/purchase recommendations** (allowed) and not cross into **tactical map actions** (banned). Riot prohibits "notifications that dictate player action based on the current game state" — e.g., "go gank top lane" or "take dragon now." Observations like "Dragon spawns in 15s and their jungler is dead" imply a tactical action and would violate this policy. The line: telling players **what to buy or pick** is allowed; telling players **what to do on the map** is not. See `docs/research/augment-detection-research.md` (Riot policy compliance section) for the full policy breakdown.

**UI hierarchy:**

- Primary slot: the big, front-and-center recommendation (augment pick, next item, build adaptation)
- Secondary strip: situational observations, less urgent but still useful

### Reactive Layer (overlay)

Voice (or text) input for situations where the player has context or intent the system can't observe:

- Disagreeing with a recommendation: "Isn't this other augment better?"
- Strategic pivots: "My augment drops haven't gone my way, how do I pivot?"
- Learning questions: "What's the bread and butter combo for this champ?"
- Situational strategy: "Should I farm or gank right now?"

The reactive layer is not a separate system. It reads from and writes to the same shared context as the proactive layer. Both layers share the same understanding of the current game state, decisions made, and advice already given.

## Shared Game Session Context

Both layers draw from a structured, living representation of the current game, not raw conversation history.

This context is maintained by observables and includes:

- Current champion, level, items, gold, augments chosen
- Build path decisions made (e.g., "went tank after picking Goliath")
- Enemy team state: comp, items, who's fed
- Recent advice given and whether it was acted on
- Active concerns (e.g., "player keeps dying to Viego", "no grievous wounds on team")
- Short-term conversational context (exact approach TBD, could be a compact summary of prior exchanges plus the last few raw exchanges for follow-up reference)

When any LLM call is made, proactive or reactive, it receives this structured snapshot, not a transcript dump. This replaces the current approach of sending full conversation history in every request.

## Mode-Agnostic Design

The core engine is not specific to any particular game mode. The architecture should be pluggable per game mode:

| Component                | Mode-Specific                      | Shared                                    |
| ------------------------ | ---------------------------------- | ----------------------------------------- |
| Game state observation   | What to observe, what APIs to poll | Observable infrastructure, polling engine |
| Decision point detection | What counts as a decision point    | Detection framework, trigger system       |
| Context assembly         | What context matters for this mode | Context structure, LLM interface          |
| Proactive rules          | When to nudge the player           | Observation-to-advice pipeline            |

Modes to eventually support:

- **ARAM Mayhem**: augments, items, stat anvils, team comp (current focus)
- **Regular ARAM**: items, team comp, no augments
- **Summoner's Rift**: lane matchups, jungle pathing, objective timers, warding, roaming
- **Arena**: augments (different system), 2v2 comp
- **TFT**: compositions, economy, item building, augments

The LLM's job stays the same across all modes: receive a focused, pre-digested context snapshot and give concise situational advice. The mode-specific modules handle what goes into that snapshot.
