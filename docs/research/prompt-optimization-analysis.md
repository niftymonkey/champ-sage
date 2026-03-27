# Coaching Prompt Optimization Analysis

Captured from investigation session on 2026-03-26. Use this document as context when picking up the prompt optimization work.

## Problem Observed

During a full ARAM Mayhem game (Warwick, 2026-03-26), the coaching model (gpt-5.4-mini) repeatedly failed to read the player's current items from the prompt context. The items were correctly present in every request — this is not a data pipeline issue. The model simply ignored what was there.

Examples from the session:

- Recommended Bami's Cinder when the player already had it
- Recommended Titanic Hydra when the player already had it
- Player had to say "I have a titanic hydra, do you not see what items I have?" before the model acknowledged it
- Player had Sunfire Aegis listed in items; model recommended against Upgrade Immolate augment saying "only if you're on the Bami/Sunfire line"
- Model literally apologized: "I should be tracking your current items better"

The coaching log file is at: `C:\Users\markd\AppData\Roaming\com.niftymonkey.champ-sage\coaching-logs\coaching-2026-03-26_16-45-40.log`

## Root Cause Assessment

The prompt has grown over time (abilities, stat profiles, augment rules, team comp, full conversation history) and critical information (items) competes with a lot of other context. At ~1400-1500 input tokens per request, gpt-5.4-mini appears to lose track of specific sections.

This is NOT caused by recent code changes. The KDA addition and prompt cleanup commits did not alter item rendering. Items are correctly shown in every logged request.

## Section-by-Section Breakdown

Below is the full prompt as actually sent during the game session, broken into labeled sections for discussion. Each section needs to be evaluated for: is it needed? can it be trimmed? should it be conditional? should it move?

### Section A — Identity & urgency (system prompt)

```
You are a League of Legends coaching AI. The player is mid-game — they need answers FAST.
```

**Decision:** Replace with:

```
You are an expert League of Legends coaching AI. Prioritize the game data provided in this prompt over your general knowledge — item stats, augment effects, and champion abilities change frequently.
```

Rationale: "FAST" was meant to influence response length but the response length rules already handle that. "Expert" sets a higher quality bar. The data prioritization instruction prevents the model from hallucinating outdated game knowledge over the current data we feed it.

### Section B — Reasoning checklist (system prompt)

```
Consider the full game context when reasoning:
- Champion abilities and playstyle
- Current items and build path
- Existing augments and synergies (in augment modes)
- Enemy team composition and threats
- Ally team composition and synergies
- Game mode and its specific dynamics
- Game time and power spikes
```

**Decision:** TBD — not yet discussed.

### Section C — Response length rules (system prompt)

```
RESPONSE LENGTH RULES (strict):
- 1-2 sentences for simple questions (what to buy, which augment).
- 3-4 bullet points max for tactical questions (when to roam, how to play a matchup).
- Never write paragraphs. Never explain what the player already knows.
- Be blunt. Give THE answer, not a menu of options with hedging.
- Only list alternatives if the player specifically asks for options.
```

**Decision:** TBD — not yet discussed.

### Section D — Augment rules (system prompt, conditional on Mayhem mode)

```
ARAM MAYHEM AUGMENT RULES (this is ARAM Mayhem mode, not regular ARAM):
- In Mayhem, players are offered 3 augment choices at levels 1, 7, 11, and 15.
- Augments are NOT items. They are permanent passive bonuses chosen from a curated set.
- Augment names can overlap with item names. Always check the Augment Options section below for the actual augment descriptions before assuming the player is talking about an item.
- When the player lists 3 options separated by commas or 'or', they are asking you to choose between augment offers.
- RE-ROLL RULES: Each of the 3 augment cards has its own independent re-roll (one use each).
  ROUND 1: Player shows 3 augments. Pick the best, tell them to re-roll the other two.
  ROUND 2: Player reports 2 new augments. You now have 3 cards: the kept one + 2 new ones.
    - If a new one beats the kept one: tell them to re-roll the kept one (its re-roll is still unused).
    - If the kept one is still best: tell them to take it. No re-rolls left on the other two.
  ROUND 3 (only if Round 2 re-rolled the kept one): Player reports 1 new augment.
    - Now pick the best of the 3 final cards. No more re-rolls exist.
  KEY: The player may only report the NEW cards. Remember which one was kept from prior rounds.
- When recommending an augment, consider: champion synergy, current build path, existing augments, and enemy team.
- CRITICAL: If an augment upgrades a specific item (like 'Upgrade Collector'), only recommend it if the player already owns that item OR is planning to build it. If they don't have the item and aren't building it, the augment is wasted.
- If an Augment Options section with descriptions appears below, use those descriptions — they are the exact in-game effects.
```

**Decision:** TBD — not yet discussed.

### Section E — Game mode & time (user prompt)

```
## Game Mode: KIWI

## Game Time: 9:17
```

**Decision:** TBD — not yet discussed.

### Section F — Champion identity (user prompt)

```
## Your Champion: Warwick (Level 10, 2/5/4 KDA)
```

**Decision:** TBD — not yet discussed.

### Section G — Stat profile (user prompt)

```
### Stat Profile
Melee | Fighter, Tank | HP: 620 (+99/lvl) | AD: 65 (+0/lvl) | AS: 0.638 (+2%/lvl) | Armor: 33 (+4.4/lvl) | MR: 32 (+2.05/lvl) | Mana
```

**Decision:** TBD — not yet discussed.

### Section H — Abilities (user prompt)

```
### Abilities
Passive: Eternal Hunger - Warwick's basic attacks deal bonus magic damage. If Warwick is below 50% health, he heals the same amount. If Warwick is below 25% health, this healing triples.
Jaws of the Beast - Warwick lunges forward and bites his target, dealing damage based on their maximum health and healing for damage dealt.
Blood Hunt - Warwick senses enemies below 50% health, gaining Move Speed toward and attack speed against them. When they fall below 25% health, he frenzies and these bonuses triple.
Primal Howl - Warwick gains damage reduction for 2.5 seconds. At the end, or if re-activated, he howls, causing nearby enemies to flee for 1 second.
Infinite Duress - Warwick leaps in a direction (scaling with his bonus Move Speed), suppressing the first champion he collides with for 1.5 seconds.
```

**Decision:** TBD — not yet discussed.

### Section I — Balance overrides (user prompt)

```
### Balance Overrides
Damage dealt: +5%, Damage taken: -5%
```

**Decision:** TBD — not yet discussed.

### Section J — Current items (user prompt)

```
### Current Items (342 gold available)
- Mercury's Treads: 20 Magic Resist | 45 Move Speed | 30% Tenacity | |
- Titanic Hydra: 40 Attack Damage | 600 Health | | Cleave | Attacks deal physical damage on-hit and to enemies behind the target. | Titanic Crescent | Empower your next Cleave to deal bonus physical damage On-Hit and deal bonus physical damage to enemies behind the target.
- Chain Vest: 40 Armor | |
- Bami's Cinder: 150 Health | 5 Ability Haste | | Immolate | After taking or dealing damage, deal magic damage to nearby enemies for 3 seconds.
- Ruby Crystal: 150 Health | |
```

**Decision:** TBD — not yet discussed. This is the section the model keeps ignoring. Possible interventions: move higher in prompt, simplify to names-only, add system prompt instruction to always check items before recommending purchases.

### Section K — Current augments (user prompt)

```
### Current Augments
- Outlaw's Grit: Dashing or blinking grants 12 bonus armor and bonus magic resistance, stacking up to 5 times for a total of 60 bonus resistances. Stacks are reset every 60 seconds since acquiring the augment.
```

**Decision:** TBD — not yet discussed.

### Section L — Team analysis (user prompt)

```
### Team Analysis
Your team roles: 1 Fighter, 1 Tank, 1 Mage, 3 Assassin, 3 Marksman — no Support. Enemy damage: mixed (3 AD, 3 AP).
```

**Decision:** TBD — not yet discussed.

### Section M — Ally team (user prompt)

```
### Ally Team
- Twitch
- Akshan
- Aurora
- Kalista
```

**Decision:** TBD — not yet discussed.

### Section N — Enemy team (user prompt)

```
### Enemy Team
- Vex: Luden's Echo, Sorcerer's Shoes, Stormsurge
- Malphite: Lich Bane, Rabadon's Deathcap, Tear of the Goddess, Boots, Glowing Mote
- Viego: Infinity Edge, Executioner's Calling, Hearthbound Axe, Rectrix, Dagger
- Miss Fortune: The Collector, Axiom Arc, Last Whisper, Long Sword, Long Sword, Glowing Mote
- Caitlyn: The Collector, Berserker's Greaves, Rapid Firecannon, Long Sword, Elixir of Wrath
```

**Decision:** TBD — not yet discussed.

### Section O — Recent conversation (user prompt)

```
## Recent Conversation
[14 exchanges of Player/Coach back-and-forth — full text in example below]
```

The conversation history in this example included 14 exchanges, many of which were the player arguing with the model about items it couldn't see. This is a significant chunk of the prompt and includes a lot of noise (failed exchanges, truncated transcripts like "Witt..." and "I choose...").

**Decision:** TBD — not yet discussed. Likely a big optimization target. History grows throughout the game and includes noise.

### Section P — Augment options being offered (user prompt, conditional)

Not present in this example request because the player wasn't choosing augments. When present, it looks like:

```
## Augment Options Being Offered

The player is choosing between these augments (NOT items):

- **Outlaw's Grit** [Gold]: Dashing or blinking grants 12 bonus armor and bonus magic resistance, stacking up to 5 times for a total of 60 bonus resistances. Stacks are reset every 60 seconds since acquiring the augment.

- **Big Brain** [Gold]: Gain a shield that absorbs damage equal to 300% AP and lasts until destroyed. Shield is replenished upon respawn.

- **Pinball** [Gold]: Your Mark is empowered to instead throw a pinball, which deals 100 to 500 bonus true damage and ricochets off of terrain that it collides with. Each time the pinball ricochets, its remaining travel distance is reset, it increases in radius by 25%, deals 20% increased damage, and reduces Mark remaining cooldown by 30% of its total. The pinball can ricochet up to 4 times, for a maximum radius increase of 100% and a damage increase of 80%. Additionally, your Mark cooldown is reduced equivalent to 50 ability haste. If Mark is not equipped, the summoner spell in the slot not occupied by Flash is replaced with Mark. If you also did not equip Flash, then you will be prompted to replace one of your summoner spells with Mark. (Snowday 1/2)
```

**Decision:** TBD — not yet discussed.

### Section Q — Question (user prompt)

```
## Question
Now what items should I buy next?
```

**Decision:** TBD — not yet discussed.

## Other Considerations

### Model evaluation

There is an existing GitHub issue (number unknown — search for model evaluation / PickAI) to evaluate alternative models. The current model (gpt-5.4-mini) was the first one that seemed OK via PickAI. A better model might handle the current prompt fine, but prompt optimization is still valuable for latency and cost regardless of model choice.

### Conversation history is a major token sink

By mid-game, the history section dominates the prompt. In this session it included 14 exchanges of full Player/Coach text, many of which were noise (truncated transcripts, the player repeating themselves because the model ignored items). History should probably be capped, summarized, or made smarter about what it includes.

### Debug panel improvements

The `fix/43-voice-without-wispr` branch already contains a commit improving App Observables summaries in the debug panel (showing actual data like "Lobby: ARAM, 3 members" instead of generic "Lobby update"). This should be shipped regardless of which issue it lands under.
