# Eval Scorers for Multi-Turn Conversation — Design

Issue: #83

## Scope

### In scope

1. **State Awareness (gate scorer)** — does the response reference
   relevant game state information?
   - Heavy healing on enemy team → mention grievous wounds
   - 3+ AP enemies → mention MR or acknowledge AP-heavy comp
   - Enemy team comp acknowledged in item recommendations
   - Player's existing items referenced in reasoning
   - Rules hardcoded in scorer. Fixture `scorerHints` declares which
     rules apply per fixture.
   - ~4-6 synthetic fixtures with item-related questions.

2. **Pivot Explanation (ranking scorer)** — when the LLM changes its
   recommendation from a prior turn, does it explain why?
   - Pivot detection: rule-based, comparing current recommendations
     against prior turn. Fixture `scorerHints` flags expected pivots
     and prior recommendations.
   - Explanation check: pattern-based, looking for causal language
     ("because," "since," "now that," etc.) or references to game
     state changes.
   - Scoring: no pivot → 1.0, pivot + explanation → 1.0, pivot +
     no explanation → 0.0, pivot expected but not detected → 0.5.
   - ~3 synthetic fixtures: explained pivot, unexplained pivot,
     consistent recommendation.

3. **Gold-Aware Recommendations (gate scorer)** — does the item
   recommendation follow the destination + component format?
   - Response names a completed (destination) item.
   - Response names a buildable component.
   - If player can afford a component, mentions one they can afford.
     If not, names the cheapest component with the gold threshold.
   - No filler items recommended just to spend gold.
   - ~4 synthetic fixtures: can afford, can't afford, multi-part
     build path, non-item question (should not trigger).
   - **Prompt change:** update ITEM RECOMMENDATIONS instruction in
     `buildSystemPrompt()` and `buildGameSystemPrompt()` to match
     the format in `docs/gold-aware-item-recommendations.md`.

4. **Augment Re-Roll Accuracy — multi-turn fixtures**
   - No scorer logic changes. Add fixtures testing cross-round
     re-roll tracking.
   - ~3 fixtures: round 1→2 tracking, "re-roll all" edge case,
     player-ignored-advice scenario.

5. **Conversational Continuity — multi-turn fixtures**
   - No scorer logic changes. Add multi-turn fixtures to the
     existing `synthetic-continuity.json`.
   - ~3-4 fixtures covering self-consistency and augment history.

### Deferred

- **Proactive Concern Flagging** — deferred because proactive coaching
  triggers (when/how the system surfaces concerns unprompted) aren't
  designed yet. Building a scorer now would test a system that doesn't
  exist, and the fixtures would be speculative. Pick this up when
  proactive coaching has a real trigger mechanism.

- **Build Coherence** — deferred because reliable automated scoring
  requires domain knowledge about augment/item/stat anvil synergies,
  especially in ARAM Mayhem where unconventional builds are a feature,
  not a bug. An LLM-as-judge would false-negative on creative-but-
  correct pivots. Revisit when we have better tooling or a curated
  set of "known good/bad" build trajectories to calibrate against.

## Architecture

- All scorers in `src/lib/ai/scorers/`, following existing
  `createScorer<EvalInput, EvalOutput>` pattern.
- Gate scorers (State Awareness, Gold-Aware) added to `GATE_SCORERS`.
- Ranking scorers (Pivot Explanation) added to `RANKING_SCORERS`.
- New multi-turn fixtures in
  `fixtures/coaching-sessions-v2/synthetic-multiturn-scorers.json`.
- Updated continuity fixtures in existing
  `fixtures/coaching-sessions-v2/synthetic-continuity.json`.
- Fixture schema extended with optional `scorerHints` field carrying
  per-fixture metadata for scorers.

## Related

- Gold-aware recommendation format: `docs/gold-aware-item-recommendations.md`
- Creative ARAM Mayhem builds: #88
