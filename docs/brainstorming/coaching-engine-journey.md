# Coaching Engine — From "Ask the LLM" to Contextual Decision Engine

How the Champ Sage coaching engine evolved from a naive LLM prompt into a structured knowledge system that makes genuinely useful mid-game decisions.

## What We Built First

The initial coaching engine was straightforward: pipe live game data into an LLM and ask it to help.

- **Model:** GPT-5.4 mini (selected via benchmarked candidate discovery — optimized for reasoning speed + quality)
- **Input:** Voice via Whisper API, triggered by in-game hotkey (low-level keyboard hook for fullscreen)
- **Context sent to model:** Champion abilities, current items, enemy team + items, current augments, ARAM balance overrides, conversation history
- **Output:** Structured JSON with answer + ranked recommendations
- **UI:** Voice-first, latest exchange only, no alt-tab needed

This worked. Response times were 1.2-2.5 seconds. The model gave contextual item advice ("Kraken into BOTRK on Bel'Veth"), referenced specific teammates ("save Nunu snowball for Diana"), and maintained conversation flow across a game session.

## What Went Wrong

Live testing in ARAM Mayhem revealed three categories of failure — and none of them were about the model being dumb.

**The model reasoned correctly from bad data.** "Quest: Urf's Champion" described itself as granting cooldown reduction and mana removal. The model correctly concluded this was low-value on Bel'Veth (an auto-attack champion). But the real reward is The Golden Spatula — a massive stat stick with +90 AD, +125 AP, +60% AS, and more. The augment description from the wiki was incomplete because our markup parser was garbling the template syntax.

**The model lacked context it needed.** It recommended Protein Shake (sustain augment) over Glass Cannon for Bel'Veth because it didn't know Bel'Veth is an auto-attack DPS carry. The champion's abilities were in the prompt, but the model had to infer playstyle from ability descriptions instead of being told directly. Similarly, it couldn't factor in team composition gaps or enemy damage types because that analysis wasn't provided.

**The model couldn't see its own prior decisions.** After a player chose an augment with build constraints (like a quest requiring specific item purchases), subsequent "what should I build?" questions didn't include those constraints. The model had to remember them from conversation history — which is unreliable.

## The Key Insight

The brainstorming session that changed everything produced one sentence:

> You are using the LLM as BOTH a knowledge base AND a reasoning engine. It should ONLY be a reasoning engine.

The model is good at reasoning — weighing tradeoffs, considering context, making recommendations. It's mediocre at being a League of Legends encyclopedia. The fix isn't better prompting; it's better data architecture. We provide the knowledge, structured and complete. The model provides the reasoning.

## What We Changed

Six improvements, each addressing a specific observed failure. All data is derived dynamically from existing sources (DDragon, League Wiki, Riot API) — nothing hardcoded that would go stale between patches.

### 1. Clean Augment Descriptions

43 of 202 augment descriptions were garbled by residual wiki markup. Rewrote the parser to handle nested templates inside-out. Result: 0/202 artifacts. The model can now read every augment's actual mechanics.

### 2. Quest Reward Stats

Quest augments say "you receive The Golden Spatula" but not what it gives. At app startup, we now find the reward item in the description, look it up in the items database, and append its stats. If Riot changes the item next patch, we pick up the new values automatically.

### 3. Chosen Augment Re-injection

After choosing an augment, the model previously only saw the name in subsequent prompts. Now the full description — including quest build constraints like "must buy Hollow Radiance and Sunfire Aegis" — is re-injected into every coaching request. Structured, always-present context beats hoping the model remembers.

### 4. Set Bonus Awareness

The model saw augment set names but had no idea what bonuses they gave or how close the player was to unlocking one. Now shows active bonuses, progress toward next threshold, and "UNLOCKS" annotations on offered augments that would complete a set. A mediocre augment that completes a strong set bonus can now correctly beat a standalone better augment.

### 5. Champion Stat Profile

Instead of a static role label ("DPS carry") that would bias the model toward one build path, we inject the champion's raw capabilities: melee/ranged, base stats with per-level growth rates, resource type. The model sees that Bel'Veth has strong defensive base stats and can reason "Goliath augment + no team tank = viable tank pivot" without being told she's always a DPS carry. The role is emergent from the game state, not prescribed.

### 6. Team Composition Analysis

Role breakdown with gap detection ("no Tank, no Support") and enemy damage profile with actionable guidance ("all AD — stack armor", "mixed damage"). The model knows when your team needs a frontline before you ask.

## Why This Matters

The difference between "ask an LLM what to do" and what we built:

**Naive approach:** Send raw game data, hope the model knows League well enough to figure it out. Works sometimes. Fails when the model's training data doesn't cover niche mechanics (ARAM Mayhem augments, quest reward items, set bonuses) or when the decision requires synthesizing information the model was never given (team composition gaps, champion build flexibility, item build constraints from prior augment choices).

**What we built:** A knowledge layer that understands League and a reasoning layer (the LLM) that explains decisions. The knowledge layer assembles structured context from live game data — champion capabilities, team gaps, enemy threats, augment mechanics, set bonus progress, build constraints. The model receives all of this pre-computed and only has to do what it's good at: weigh the tradeoffs and pick the best option given the current situation.

The result is a coaching engine that adapts to the actual game state. Same champion, same augment offered, different recommendation depending on what your team needs, what the enemy is building, and what you've already committed to. That's the whole point — decisions in the moment, not static guides.

## By the Numbers

- **340 tests** covering the full pipeline
- **~1,000-1,300 tokens** per coaching prompt (well within budget)
- **1.2-3.5 second** response times in-game
- **0/202** augment descriptions with markup artifacts (down from 43)
- **24 commits** on the feature branch
- **6 coaching quality improvements**, all derived from dynamic data sources
