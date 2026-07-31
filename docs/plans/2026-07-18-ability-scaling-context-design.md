# Ability Scaling Context for Augment and Item Reasoning

**Date:** 2026-07-18
**Status:** Implemented 2026-07-18. During implementation the innate renderer additionally learned the icon-template family (sti/stil/ci/cci/cis/ais/ccs/rutngt/times/bug), variable substitution, and arithmetic evaluation, lifting innate coverage from 45/173 to 155/173; see `docs/reference/technical-reference.md` for the details.
**Motivation:** Live-game observation that augment fit grades run low: augments the player knows benefit the champion get rated "weak" or "situational". Suspected cause is missing champion information (passive effects, damage scaling) rather than model capability. No single confirmed misgrade exists; this design fills the identified information gaps and makes the model's use of scaling auditable, while deliberately leaving the fit-tier calibration untouched so any improvement is attributable to information.

## What the model sees today

Per-ability scaling from the League Wiki (issue #146) renders inline per spell:

```
Q - Dark Binding: <DDragon description> [CD 10s | cost 50/55/60/65/70 | range 1250 | Magic Damage: 80/135/190/245/300 (+ 90% AP) | Root Duration: 2 to 3 seconds]
```

Three gaps:

1. **The passive carries no numbers.** It renders as `Passive: <name> - <DDragon flavor text>`. Passives are disproportionately what augments synergize with (on-hit, heal-on-damage, stacking passives), and the model gets only vague prose about them.
2. **No champion-level synthesis.** The model must assemble "this champion converts AP into damage AND shields at high ratios" from up to eight bracket fragments mid-decision.
3. **The augment-fit prompt never names the mechanism.** "Synergy" is gestured at, but the model is never told to weigh an augment's granted stat against the champion's ratios.

## Design

### 1. Passive ability data from the wiki innate pages

Extend the wiki ability fetch (`src/lib/data-ingest/sources/wiki-champion-abilities.ts`) to request each champion's `Template:Data <Champion>/I` page alongside Q/W/E/R. The existing batched fetch and redirect resolution already handle the `/I` redirect form (verified: `Template:Data Morgana/I` redirects to `Template:Data Morgana/Soul Siphon`, same `Ability data` template, `skill = I`).

**Innate pages do not use `leveling` params.** Innates scale with champion level, not ability rank; their numbers live in the `description`/`description2`/`description3` params via templates like `{{pplevel|26 to 196|type=his level|label1=level}}` or plain prose ("18% of the post-mitigation damage"). Verified on Morgana, Braum, Ashe, Kog'Maw, Jinx: zero leveling params on all five. So the rank-based scaling parser is NOT applied to `/I`; instead the description params are rendered to plain text via `stripWikiMarkup` (`src/lib/data-ingest/parsers/wiki-markup.ts`), which already handles nearly every template these pages use. One addition: a `pplevel` case, with this contract:

- Take the first positional (non-`name=value`) param verbatim and suffix "(based on level)". Named params (`type=`, `label1=`, `changedisplay=`...) are presentation hints and are dropped.
- Plain form: `{{pplevel|26 to 196|type=his level|label1=level}}` renders `26 to 196 (based on level)`.
- Arithmetic form: `{{pplevel|26*0.4 to 196*0.4}}` renders `26*0.4 to 196*0.4 (based on level)`: expressions are preserved verbatim, not evaluated. `stripWikiMarkup` has no expression evaluator and the unevaluated form is still unambiguous to an LLM; evaluating is a possible later refinement, not part of this design.
- Nested templates resolve inside-out as today, so a nested unknown template still fires `onUnknownTemplate` and quarantines the whole passive description (fall back to DDragon text) rather than dropping content silently.

Behavior:

- A cleanly rendered wiki description **replaces** the DDragon passive text at ingest-merge time (`description` is overwritten; the prompt renderer stays dumb, no new optional field).
- Quarantine-on-doubt: if `onUnknownTemplate` fires during rendering, discard the wiki version and keep DDragon text. A missing `/I` page falls back silently.
- Cache version bumps so existing installs re-ingest.

Example (Morgana):

- Before: `Passive: Soul Siphon - Morgana drains spirit from her enemies, healing as she deals damage...`
- After: `Passive: Soul Siphon - Innate: Morgana heals herself for 18% of the post-mitigation damage dealt by her abilities against champions, large minions, and medium and large monsters.`

### 2. Derived "Scaling profile" line

A deterministic summary appended as the last line of the Abilities block in `buildBaseContext`, computed at prompt-build time from stored `AbilityScalingStat` values. No new data source.

```
Scaling profile: AP - Q 90%, W up to 200%, E 70% (shield), R up to 160%. No AD ratios.
```

Derivation rules:

- Scan each spell's scaling values with a strict regex on the `(+ N% STAT)` token form. Group by verbatim stat name; take the max ratio per stat per ability (per-tick 10% and total 200% reports 200%, rendered "up to" when multiple ratios collapsed).
- **Strict parse or skip:** a non-matching value contributes nothing; if no ratios parse anywhere, omit the whole line rather than render it empty.
- **Utility marker:** when the stat label is non-damage (Shield Strength, Heal), append a parenthetical like `(shield)` so defensive scaling is visible.
- **Negative statement** only for AP and AD (the stats augments most commonly grant): `No AD ratios` is as decision-relevant as the positive ratios.
- **Passive excluded from the math:** its numbers are prose (section 1), not structured stats. Profile derives from Q/W/E/R only.

Placement rationale: last line of the block reads as a summary of the detail directly above it.

### 3. Augment-fit prompt instruction

Add one rule to `AUGMENT_FIT_TASK_PROMPT` (`src/lib/ai/features/augment-fit/prompt.ts`) in the fit-rating block:

> STAT SYNERGY: The champion profile includes per-ability scaling ratios and a Scaling profile summary. When an augment grants or amplifies a stat, weigh it against those ratios: an augment feeding a stat the kit converts at high ratios (or that powers a defensive ratio like a shield or heal) fits better than the same augment on a champion with no ratio in that stat. Cite the relevant ability or ratio in your reasoning.

The cite clause forces grounding and creates an audit trail: future suspect grades will show in their reasoning whether the ratios were consulted.

Deliberately out of scope:

- **No change to the "exceptional is RARE" calibration language.** If underrating persists once the model can see the passive and ratios, calibration is the next lever, with evidence to justify it.
- **Item-rec prompt unchanged.** Item choice leans on the tier-1 meta pool (community-proven builds) which embeds scaling implicitly; augments are where the model reasons from first principles and where the failures were observed.

### 4. Diagnostics rename

The prompt-verification summary field `scalingRatios=N` (a count of `(+ ` occurrences in the rendered prompt) reads as if it were the data itself and confused a human reader. Rename to `scalingRatioTokens` with a comment stating it is a verification count. No behavior change.

## Testing

TDD, red on assertions first:

- `wiki-markup`: `pplevel` plain form, the arithmetic form (Braum description3), and no unknown-template report for it.
- Innate fetch/render: fixture tests on realistic wikitext (Morgana prose-only shape, Braum pplevel shape): clean render replaces DDragon text; unknown template quarantines and falls back; missing page falls back silently.
- Merge: passive overwrite at ingest-merge; cache version bump forces re-ingest.
- Profile derivation: ratio extraction, max-per-stat within an ability, "up to" collapse, `(shield)` marker, `No AD ratios`, full omission when nothing parses.
- `base-context`: profile line renders last in Abilities; absent without scaling data.
- Prompt guard: STAT SYNERGY rule present in the augment-fit task prompt.

## Verification

- `pnpm dump-champion-prompt Morgana Braum Ashe`: eyeball passive numbers and profile lines.
- `pnpm measure-cache`: passive text adds roughly 50KB across all champions against the ~5MB cap; confirm.
- `pnpm eval` before commit: this adds real prompt content (unlike pure removals), but treat single-run movement inside the +/-5 noise floor as noise (`docs/reference` eval-noise notes).
- Live Mayhem games: the observable success criterion is augment reasoning that cites ratios, enabled by the cite clause.
