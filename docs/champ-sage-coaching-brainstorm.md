# Champ Sage — Coaching Engine Brainstorm (Improvement Discussion)

## What We’re Solving (Grounded in Current System)

Champ Sage is a real-time, voice-driven coaching assistant that provides contextual, mid-game recommendations based on:

- Live game state (Riot Live Client Data API)
- Static game data (champions, items, augments, ARAM overrides)
- Player-provided augment input (since augments are not exposed via API)
- A running conversation history within a single game session

Core differentiator:

- Not static win-rate builds
- Not pre-game recommendations
- Context-aware decisions at the moment of choice

---

## Current Coaching Engine Reality

The coaching engine today:

- Uses GPT-5.4 mini via Vercel AI SDK
- Relies on:
  - System prompt (rules + ARAM mechanics)
  - User prompt (full game context)
  - Conversation history (entire session)

Injects:

- Champion abilities
- Items
- Enemy team + items
- Current augments
- Augment options

Limitation:
The model relies on its training data for game knowledge (augment synergies, builds, matchups)

---

## Core Problem

1. Model Knowledge Gap

- Doesn’t understand ARAM Mayhem deeply
- Doesn’t know augment mechanics natively
- Not up-to-date on meta

2. Prompt/Context Limits

- Large prompts degrade performance
- Too much info reduces reasoning quality

---

## Key Insight

You are currently using the LLM as BOTH:

- Knowledge base
- Reasoning engine

It should ONLY be:

- Reasoning engine

---

## Correct Mental Model

You = Game Engine + Data Curator  
LLM = Decision Engine

---

## Improvements

### 1. Move Knowledge Out of the Model

Provide structured knowledge instead of expecting the model to know it.

### 2. Add Pre-Reasoning Layer

Classify:

- Champion role
- Augment roles
- Synergies and conflicts

### 3. Use Curated Context

Only send what matters NOW (early/mid/late game).

### 4. Add Game State Interpretation

Convert raw data into insights:

- Threat detection
- Build direction
- Weaknesses

### 5. Use Win Rate as Baseline Only

- Filter options
- Not final decision driver

### 6. Compress Context

Replace long descriptions with tags:
Example:
Kraken Slayer → DPS, on-hit, anti-tank

### 7. Use Decision Frames

Structure inputs:

- Decision type
- Role
- Build path
- Enemy threats

---

## Improved Flow

Game State → Interpretation Layer → Curated Context → LLM → Output

---

## Next Steps

1. Champion role classifier
2. Augment tagging system
3. Synergy/conflict detection
4. Replace raw descriptions with tags
5. Add game phase awareness
6. Use win rate as supporting signal

---

## Big Reframe

You are not building:
“An AI that knows League”

You are building:
“A system that understands League and uses AI to explain decisions”
