# Coaching Eval Scoring Criteria

Defines what "good coaching output" looks like for the Champ Sage model evaluation pipeline (#10). Derived from the product vision. These criteria apply regardless of which model or prompt shape we use.

## Context Awareness (Gate)

The model MUST demonstrate that it has read and understood the game state provided in the prompt. Failure here disqualifies a model regardless of other scores.

### Item Awareness

- Does the response acknowledge the player's current items?
- Does it avoid recommending items the player already owns?
- Does it recommend items that make sense given what the player has built so far?

**Test case from 2026-03-26 session:** Player has Titanic Hydra and Bami's Cinder. Model recommends buying Bami's Cinder. Score: 0.

### Augment Awareness

- Does the response acknowledge the player's current augments?
- Does it consider augment synergies with the player's build?
- For augment upgrade recommendations (e.g., "Upgrade Immolate"), does it check whether the player owns the prerequisite item?

**Test case:** Player has Sunfire Aegis. Model says Upgrade Immolate is "only good if you're on the Bami/Sunfire line." Score: 0.

### Enemy Awareness

- Does the response account for the enemy team composition?
- Does it reference specific enemy threats when recommending defensive items?

## Augment Re-Roll Accuracy (Gate)

When advising on augment re-rolls, the model MUST follow the actual game mechanics:

- Never suggest re-rolling a card that has already been re-rolled
- Correctly track which cards have been kept vs replaced across rounds
- Understand that re-rolls are tied to card positions, not free-floating

**Test case:** After round 1, player re-rolled cards A and B. Model suggests re-rolling A again. Score: 0.

## Recommendation Quality (Ranking)

### Champion-Context Fit

- Does the recommendation account for the champion's playstyle and scaling?
- Does it consider the champion's abilities when evaluating augment/item synergies?

**Example:** Recommending an AP-scaling augment for an AD champion should score low. Recommending Outlaw's Grit for Warwick (who dashes with R) and explaining why should score high.

### Build Path Coherence

- Does the recommendation fit with the player's existing build direction?
- If the player has committed to a tank build, does it continue recommending tank items unless there's a compelling reason to pivot?
- When suggesting a pivot, does it acknowledge the pivot and explain why?

### Situational Reasoning

- Does the response consider the current game state (time, kills/deaths, enemy power spikes)?
- Does it adapt recommendations based on whether the player is ahead or behind?

## Response Format (Gate)

### Brevity

- Augment/item questions: 1-2 sentences max
- Tactical questions: 3-4 bullet points max
- No paragraphs, no restating what the player already knows

### Decisiveness

- Gives THE answer, not a menu of hedged options
- Only lists alternatives when the player specifically asks for options

## Response Stability (Ranking)

### Consistency Across Identical Context

- If nothing has changed about the game state, asking the same question should produce the same recommendation
- The model should not give "Heartsteel" three times and then "Thornmail" on the fourth ask just due to temperature randomness
- This is critical for player trust. If the player can't remember what they were told and asks again, they should get the same answer

**Note:** This may ultimately be solved architecturally rather than at the model level. If the proactive layer has already computed a recommendation and the game state hasn't changed, the system could surface the cached recommendation instead of making a new LLM call. But at the model level, we still want to measure stability.

### Build Path Continuity

- Recommendations should build on previous decisions (e.g., if the player chose tank augments, item advice should reflect that path)
- However, if the game state _has_ changed (player pivoted, enemy comp shifted, new augments chosen), the model should adapt and not blindly repeat previous advice

## Scorer Implementation Notes

### Gate vs Ranking

- **Gate scorers** are pass/fail. Any model that fails a gate is not viable. Threshold: 0.80.
- **Ranking scorers** are 0-1 scale. Used to compare viable models against each other.

### Test Fixtures

- Primary source: coaching log from 2026-03-26 game session (Warwick, ARAM Mayhem)
- Contains 20+ exchanges including multiple context awareness failures
- Located at: `C:\Users\markd\AppData\Roaming\com.niftymonkey.champ-sage\coaching-logs\coaching-2026-03-26_16-45-40.log`
- Should be extracted into structured fixtures in `fixtures/coaching-sessions/`

### Deterministic vs LLM-as-Judge

- Context awareness scorers (item/augment/enemy awareness) should be **deterministic**: parse the response and check against the provided game state
- Recommendation quality scorers may need **LLM-as-judge**: a separate model evaluating whether the advice is sound
- Response format scorers should be **deterministic**: word count, structure checks
