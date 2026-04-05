# Gold-Aware Item Recommendations

## Problem

The coaching LLM's item recommendations have oscillated between three failure modes: hedging about gold ("if you can afford it"), recommending only components without naming the destination item, and sometimes ignoring gold entirely to suggest unaffordable items or unrelated alternatives.

## Core Rule

Every item recommendation — whether reactive (player asked) or proactive (LLM flagged a gap) — follows the same format:

**Destination item first, then the actionable component.**

- **Can afford a component:** "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now."
- **Can't afford any component:** "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod at 1250g."
- **Multiple components, partial affordability:** Name the most expensive component the player can currently afford.
- **Non-item questions that mention items** (e.g., "how do I deal with Katarina"): Just name the completed item. No component breakdown needed.

## Key Decisions

- Destination item always leads — it's the strategic decision
- Component is the tactical detail, gated by current gold
- Use the target gold threshold ("at 1250g"), not the gap ("in 150g")
- Never recommend unrelated "filler" items just because the player can afford them
- Never hedge with "if you can afford" — the app knows the player's gold
- Same format for proactive and reactive recommendations

## Prompt Changes Needed

Update the ITEM RECOMMENDATIONS instruction in the system prompt to reflect the format and rules above, replacing the current example.
