/**
 * Presence signals scanned from an assembled base context, for a verification
 * log line that survives at the default `info` level.
 *
 * These are deliberately SIGNALS, not truth: they scan the rendered prompt for
 * the stable section markers `buildBaseContext` emits, so a fresh session logs
 * at a glance whether abilities, ability scaling, and the wider item catalog
 * actually reached the prompt. A count dropping to zero (no abilities section,
 * no scaling ratios, a handful of catalog items instead of ~150) is the
 * regression tell after a data-source or ingest change, without needing debug
 * logging switched on before the match.
 *
 * Stub returns are intentionally wrong so the tests fail on assertions.
 */
export interface BaseContextSummary {
  /** Whether the "### Abilities" section rendered at all. */
  hasAbilities: boolean;
  /** Count of "(+ ... )" scaling-ratio fragments (e.g. "(+ 50% AP)"). */
  scalingRatios: number;
  /** Count of tier-2 "Other available items" reference lines. */
  catalogItems: number;
  /** Compact one-line rendering for the log. */
  line: string;
}

export function summarizeBaseContext(text: string): BaseContextSummary {
  const hasAbilities = text.includes("### Abilities");

  // Ratio-bearing scaling stats render "(+ 50% AP)", "(+ 100% bonus AD)", etc.
  // Flat scaling ("Bonus Health: 300 to 600") has no ratio and is not counted,
  // so this is a lower bound: a great regression tell (0 means scaling broke),
  // not a total.
  const scalingRatios = (text.match(/\(\+ /g) ?? []).length;

  // Tier-2 reference items are the only lines rendered as "- Name ...". Tier-1
  // items use "**Name**" and ability lines use "Q - Name:", so neither is
  // caught by an anchored "- " match.
  const catalogItems = (text.match(/^- /gm) ?? []).length;

  const line = `abilities=${hasAbilities ? "yes" : "no"} scalingRatios=${scalingRatios} catalogItems=${catalogItems}`;

  return { hasAbilities, scalingRatios, catalogItems, line };
}
