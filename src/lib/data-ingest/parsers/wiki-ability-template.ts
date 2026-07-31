import type { AbilityScalingStat } from "../types";
import { stripWikiMarkup } from "./wiki-markup";
import { evaluateExpression } from "./arithmetic";

export type SpellSlot = "Q" | "W" | "E" | "R";

const SPELL_SLOTS: readonly SpellSlot[] = ["Q", "W", "E", "R"];

export type QuarantineReason =
  | { kind: "unknown-template"; template: string }
  | { kind: "unresolved-variable"; variable: string }
  | { kind: "arithmetic-failed"; expression: string }
  | { kind: "residual-markup" }
  | { kind: "no-numeric-value" }
  | { kind: "malformed-leveling" };

export interface QuarantinedStat {
  /** Best-effort label; empty when the leveling param itself was malformed. */
  label: string;
  reason: QuarantineReason;
}

export interface ParsedAbilityTemplate {
  /** Champion name as the wiki page declares it, or null when absent. */
  champion: string | null;
  /** Spell slot as the wiki page declares it, or null when absent/unknown. */
  slot: SpellSlot | null;
  /** Stats that parsed cleanly and are safe to surface. */
  stats: AbilityScalingStat[];
  /** Stats deliberately dropped, with why. Drives the audit breakdown. */
  quarantined: QuarantinedStat[];
}

/**
 * Parse a League Wiki `Template:Data <Champion>/<Slot>` page into per-ability
 * scaling.
 *
 * Scaling lives in `leveling`/`leveling2`/`leveling3`... params, each holding
 * one or more `{{st|Label|value|...}}` stat tables, numbered to pair with the
 * matching `description` param. Values routinely embed unevaluated arithmetic
 * (`{{ap|40*0.4 to 120*0.4}}`) and page-scoped variables (`{{#var:b1}}` defined
 * by a `{{#vardefine}}` preamble), both of which are resolved here.
 *
 * Every stat must survive a strict gate to be emitted: unknown templates,
 * unresolved variables, failed arithmetic, residual markup, and value text
 * carrying no number all quarantine that stat instead of guessing. Wrong
 * numbers in a coaching prompt are worse than absent ones, and the wiki's
 * long tail (`{{ccd}}`, `{{critical damage}}`, `{{#invoke:}}`) is exactly the
 * shape that produces plausible-but-wrong text under lenient stripping.
 */
export function parseAbilityTemplate(
  rawWikitext: string
): ParsedAbilityTemplate {
  // Strip comments before anything reads the page. Commented-out content is
  // not data: a commented `|leveling = ...` still starts a line with a pipe and
  // would be read as live by the line-anchored param scan, and a commented
  // `{{#vardefine}}` would define a variable the page has actually retired.
  // Doing this first also fixes up the comments the wiki uses purely to wrap
  // long params across lines, which land between "{{st" and its first pipe.
  const wikitext = stripWikitextComments(rawWikitext);

  const variables = extractPageVariables(wikitext);
  const params = extractNamedParams(wikitext);

  const stats: AbilityScalingStat[] = [];
  const quarantined: QuarantinedStat[] = [];

  for (const leveling of collectNumberedParams(params, "leveling")) {
    const tables = extractStatTables(leveling);
    if (tables.length === 0) {
      quarantined.push({ label: "", reason: { kind: "malformed-leveling" } });
      continue;
    }
    for (const table of tables) {
      parseStatTable(table, variables, stats, quarantined);
    }
  }

  return {
    champion: params.get("champion")?.trim() || null,
    slot: parseSlot(params.get("skill")),
    stats,
    quarantined,
  };
}

export interface ParsedInnateTemplate {
  /** Champion name as the wiki page declares it, or null when absent. */
  champion: string | null;
  /** "I" when the page declares the innate skill slot, null otherwise. */
  slot: "I" | null;
  /** Plain-text rendering of the description params, or null when the page has none or the rendering cannot be trusted. */
  description: string | null;
  /**
   * Why a rendering was discarded, or null when it succeeded or the page
   * simply had no description. Feeds the audit's teach-the-renderer-next
   * breakdown exactly like quarantined spell stats do.
   */
  quarantine: QuarantineReason | null;
}

/**
 * Parse a League Wiki `Template:Data <Champion>/I` innate page.
 *
 * Innates scale with champion level rather than ability rank, so these pages
 * carry no `leveling` params: their numbers live inside the `description`
 * params as `{{pplevel}}` templates or plain prose. The description params are
 * therefore rendered to plain text instead of going through the rank-based
 * stat parser, under the same quarantine-on-doubt rule: anything the renderer
 * would have to guess at discards the whole rendering, and the caller keeps
 * the DDragon passive text.
 */
export function parseInnateTemplate(rawWikitext: string): ParsedInnateTemplate {
  const wikitext = stripWikitextComments(rawWikitext);
  const variables = extractPageVariables(wikitext);
  const params = extractNamedParams(wikitext);
  const rendered = renderInnateDescription(
    collectNumberedParams(params, "description"),
    variables
  );

  return {
    champion: params.get("champion")?.trim() || null,
    slot: params.get("skill")?.trim().toUpperCase() === "I" ? "I" : null,
    ...rendered,
  };
}

/**
 * Render an innate page's description params as one plain-text paragraph, or
 * null when nothing trustworthy remains. Parser functions are refused up front
 * because stripWikiMarkup deletes them silently, which would drop exactly the
 * numbers the innate exists to supply; unknown templates are refused for the
 * same reason lenient stripping is refused on stats: plausible-but-wrong text
 * in a coaching prompt is worse than the DDragon fallback.
 */
type InnateRender = Pick<ParsedInnateTemplate, "description" | "quarantine">;

/**
 * Staged like resolvePart, and for the same reasons: variables first
 * (arithmetic depends on their values), then arithmetic, then the check for
 * leftover parser functions (which stripWikiMarkup would delete silently,
 * dropping exactly the numbers the innate exists to supply), then prose
 * stripping under unknown-template watch.
 */
function renderInnateDescription(
  descriptions: string[],
  variables: Map<string, string>
): InnateRender {
  if (descriptions.length === 0) return { description: null, quarantine: null };

  const rendered: string[] = [];
  for (const raw of descriptions) {
    const substituted = substituteVariables(raw, variables);
    if (!substituted.ok) {
      return { description: null, quarantine: substituted.reason };
    }

    const evaluated = resolveArithmetic(substituted.text);
    if (!evaluated.ok) {
      return { description: null, quarantine: evaluated.reason };
    }

    const parserFunction = /\{\{(#\w+)/.exec(evaluated.text);
    if (parserFunction) {
      return {
        description: null,
        quarantine: { kind: "unknown-template", template: parserFunction[1] },
      };
    }

    const unknown: string[] = [];
    const text = stripWikiMarkup(evaluated.text, {
      onUnknownTemplate: (name) => unknown.push(name),
    });
    if (unknown.length > 0) {
      return {
        description: null,
        quarantine: { kind: "unknown-template", template: unknown[0] },
      };
    }
    rendered.push(text);
  }

  const joined = rendered.join(" ").replace(/\s+/g, " ").trim();
  if (joined === "") return { description: null, quarantine: null };

  // Surviving quote runs or brackets mean the page used markup the renderer
  // did not fully resolve (an unclosed bold marker, a malformed template);
  // mangled prose in a coaching prompt is worse than the DDragon fallback.
  if (/''|[{}[\]]/.test(joined)) {
    return { description: null, quarantine: { kind: "residual-markup" } };
  }

  return { description: joined, quarantine: null };
}

/**
 * Remove `<!-- ... -->` comments, including unterminated ones. An unclosed
 * comment blanks the rest of the page rather than being ignored, matching how
 * MediaWiki renders it: treating the tail as live data would resurrect exactly
 * the content the author commented out.
 */
function stripWikitextComments(wikitext: string): string {
  return wikitext.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");
}

function parseSlot(raw: string | undefined): SpellSlot | null {
  const value = raw?.trim().toUpperCase();
  return SPELL_SLOTS.find((slot) => slot === value) ?? null;
}

/**
 * Collect a numbered param family (`leveling`, `leveling2`, `leveling3`... or
 * `description`, `description2`...) in the page's own numeric order. Sorted
 * numerically rather than lexically so `leveling10` follows `leveling2`, and
 * so values read in the same order the ability describes them.
 */
function collectNumberedParams(
  params: Map<string, string>,
  base: string
): string[] {
  const pattern = new RegExp(`^${base}(\\d*)$`);
  const numbered: Array<{ order: number; value: string }> = [];

  for (const [name, value] of params) {
    const match = pattern.exec(name);
    if (!match || !value.trim()) continue;
    numbered.push({ order: match[1] === "" ? 1 : Number(match[1]), value });
  }

  return numbered.sort((a, b) => a.order - b.order).map((entry) => entry.value);
}

/**
 * Extract page-scoped variables from the `{{#vardefine:name|value}}` preamble
 * the wiki uses to hoist an ability's tunable numbers to the top of the page.
 *
 * Values are read with brace matching rather than a regex because a definition
 * can nest templates (`{{#vardefine:total_ticks|{{#expr:...}}}}`), which a
 * pattern terminating on the first `}}` would truncate mid-expression.
 */
function extractPageVariables(wikitext: string): Map<string, string> {
  const variables = new Map<string, string>();
  const opener = /\{\{#vardefine:\s*([^|}]+?)\s*\|/g;

  for (const match of wikitext.matchAll(opener)) {
    const valueStart = match.index + match[0].length;
    const end = findClosingBraces(wikitext, valueStart);
    if (end === null) continue;
    variables.set(match[1], wikitext.slice(valueStart, end).trim());
  }

  return variables;
}

/**
 * Extract top-level `|name = value` params. Anchored on lines starting with a
 * pipe, which is how the wiki formats these pages, because brace-depth tracking
 * is defeated by the `{{{{{1|Ability data}}}` invocation header that opens
 * every page with unbalanced braces.
 */
function extractNamedParams(wikitext: string): Map<string, string> {
  const params = new Map<string, string>();
  // The sentinel gives the final real param a terminator to match against.
  const text = `${wikitext}\n|__end__ =`;
  const pattern = /^\|\s*([a-zA-Z0-9 _]+?)\s*=\s*([\s\S]*?)(?=^\|)/gm;

  for (const match of text.matchAll(pattern)) {
    params.set(match[1].trim().toLowerCase(), match[2].trim());
  }

  return params;
}

/**
 * Find each top-level `{{st|...}}` block, returning the content between the
 * braces. A single leveling param often holds several stat tables in a row, so
 * a greedy regex would splice the first table's label onto the last table's
 * value and silently invent a stat.
 */
function extractStatTables(leveling: string): string[] {
  const tables: string[] = [];
  const opener = /\{\{st\s*\|/g;

  for (const match of leveling.matchAll(opener)) {
    const contentStart = match.index + match[0].length;
    const end = findClosingBraces(leveling, contentStart);
    if (end === null) continue;
    tables.push(leveling.slice(contentStart, end));
  }

  return tables;
}

/** Index of the `}}` closing the template whose content starts at `start`. */
function findClosingBraces(text: string, start: number): number | null {
  let depth = 0;

  for (let i = start; i < text.length - 1; i++) {
    if (text.startsWith("{{", i)) {
      depth++;
      i++;
      continue;
    }
    if (text.startsWith("}}", i)) {
      if (depth === 0) return i;
      depth--;
      i++;
    }
  }

  return null;
}

/** Split template params on pipes that sit outside any nested template. */
function splitTopLevelParams(content: string): string[] {
  const params: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < content.length; i++) {
    if (content.startsWith("{{", i) || content.startsWith("[[", i)) {
      depth++;
      current += content.slice(i, i + 2);
      i++;
      continue;
    }
    if (content.startsWith("}}", i) || content.startsWith("]]", i)) {
      depth--;
      current += content.slice(i, i + 2);
      i++;
      continue;
    }
    if (content[i] === "|" && depth === 0) {
      params.push(current);
      current = "";
      continue;
    }
    current += content[i];
  }
  params.push(current);

  return params;
}

function parseStatTable(
  table: string,
  variables: Map<string, string>,
  stats: AbilityScalingStat[],
  quarantined: QuarantinedStat[]
): void {
  const params = splitTopLevelParams(table);

  // Params alternate label/value. A trailing label with no value is not a stat.
  for (let i = 0; i + 1 < params.length; i += 2) {
    const label = resolvePart(params[i], variables);
    const value = resolvePart(params[i + 1], variables);

    // Report the label when it resolved, so the audit can name the offender.
    const reported = label.ok ? label.text : "";

    if (!label.ok) {
      quarantined.push({ label: reported, reason: label.reason });
      continue;
    }
    if (!value.ok) {
      quarantined.push({ label: reported, reason: value.reason });
      continue;
    }
    if (!label.text || !value.text) {
      quarantined.push({
        label: reported,
        reason: { kind: "residual-markup" },
      });
      continue;
    }
    // Scaling without a number is prose, not scaling.
    if (!/\d/.test(value.text)) {
      quarantined.push({
        label: reported,
        reason: { kind: "no-numeric-value" },
      });
      continue;
    }

    stats.push({ label: label.text, value: value.text });
  }
}

type ResolvedPart =
  | { ok: true; text: string }
  | { ok: false; reason: QuarantineReason };

/**
 * Resolve one label or value to plain text, or report why it cannot be trusted.
 *
 * Ordered so each stage only sees what the previous one could not have broken:
 * variables first (arithmetic depends on their values), then arithmetic
 * innermost-first (`{{as|(+ {{ap|50*2}}% AP)}}` needs the inner `ap` gone
 * before the outer `as` is stripped), then prose stripping, then the gate.
 */
function resolvePart(
  raw: string,
  variables: Map<string, string>
): ResolvedPart {
  const substituted = substituteVariables(raw, variables);
  if (!substituted.ok) return substituted;

  const evaluated = resolveArithmetic(substituted.text);
  if (!evaluated.ok) return evaluated;

  // Parser functions never survive to here on a shape we understand, and
  // stripWikiMarkup deletes them silently, so refuse them explicitly.
  const parserFunction = /\{\{(#\w+)/.exec(evaluated.text);
  if (parserFunction) {
    return {
      ok: false,
      reason: { kind: "unknown-template", template: parserFunction[1] },
    };
  }

  const unknown: string[] = [];
  const text = stripWikiMarkup(evaluated.text, {
    onUnknownTemplate: (name) => unknown.push(name),
  });

  if (unknown.length > 0) {
    return {
      ok: false,
      reason: { kind: "unknown-template", template: unknown[0] },
    };
  }

  // stripWikiMarkup turns pipes into spaces and drops unknown templates rather
  // than failing, so anything structural left here means the text is not what
  // it appears to be. Arithmetic operators surviving mean an expression went
  // unevaluated, which would read as "40*0.4" in a coaching prompt.
  if (/[{}[\]|*=#]/.test(text)) {
    return { ok: false, reason: { kind: "residual-markup" } };
  }

  return { ok: true, text: text.trim() };
}

/**
 * Replace `{{#var:name}}` references with their defined values, repeatedly.
 *
 * A vardefine's value can itself reference other variables (Fiddlesticks
 * defines `total_ticks` as an expression over `channel_duration` and
 * `channel_tickrate`), so one pass substitutes a value that still holds
 * `{{#var:}}` refs. Iterates to a fixpoint, bounded against a cyclic
 * definition.
 */
function substituteVariables(
  raw: string,
  variables: Map<string, string>
): ResolvedPart {
  let missing: string | null = null;
  let text = raw;

  for (let pass = 0; pass < 10 && text.includes("{{#var:"); pass++) {
    const before = text;

    text = text.replace(/\{\{#var:\s*([^|}]+?)\s*\}\}/g, (_match, name) => {
      const value = variables.get(name);
      if (value === undefined) {
        missing ??= name;
        return "";
      }
      return value;
    });

    if (missing !== null) {
      return {
        ok: false,
        reason: { kind: "unresolved-variable", variable: missing },
      };
    }
    if (text === before) break;
  }

  // Falling out of the loop with markers still present means substitution
  // never reached a fixpoint (a self-referential or mutually-recursive
  // vardefine). The residual-markup gate downstream would quarantine this
  // anyway, but reporting it as unresolved-variable keeps the audit's reason
  // breakdown honest about WHY a stat was dropped.
  if (text.includes("{{#var:")) {
    const name = /\{\{#var:\s*([^|}]+?)\s*\}\}/.exec(text)?.[1] ?? "unknown";
    return {
      ok: false,
      reason: { kind: "unresolved-variable", variable: name },
    };
  }

  return { ok: true, text };
}

/**
 * Evaluate `{{ap|...}}` and `{{#expr:...}}` innermost-first.
 *
 * `ap` carries either a single expression or a rank-1-to-max range written
 * `X to Y`, where each side may itself be arithmetic. Plain non-numeric `ap`
 * content is passed through untouched: `{{ap|35 to 135}}` is already the
 * condensed form, and only expressions need collapsing.
 */
function resolveArithmetic(text: string): ResolvedPart {
  let result = text;
  let failure: QuarantineReason | null = null;

  // Innermost templates first: {{ap|...}} whose content holds no nested {{ }}.
  const innermost = /\{\{(ap|#expr):([^{}]*)\}\}|\{\{(ap)\|([^{}]*)\}\}/g;

  for (let iteration = 0; iteration < 20; iteration++) {
    const before = result;

    result = result.replace(
      innermost,
      (match, exprName, exprBody, apName, apBody) => {
        const isExpr = exprName === "#expr";
        const body = isExpr ? exprBody : apBody;
        if (!isExpr && apName === undefined) return match;

        const rendered = isExpr ? renderExpression(body) : renderApValue(body);
        if (rendered === null) {
          failure ??= {
            kind: "arithmetic-failed",
            expression: String(body).trim(),
          };
          return match;
        }
        return rendered;
      }
    );

    if (failure) return { ok: false, reason: failure };
    if (result === before) break;
  }

  return { ok: true, text: result };
}

function renderExpression(body: string): string | null {
  const value = evaluateExpression(body);
  return value === null ? null : formatNumber(value);
}

/**
 * Render `{{ap|...}}` content: an explicit per-rank series, a `X to Y` range,
 * or a single expression. Content that is not arithmetic at all
 * (already-condensed text) passes through, since `ap` is also used for styling.
 */
function renderApValue(body: string): string | null {
  // Named options (`round=4`) configure rendering and are not values.
  const positional = body.split("|").filter((part) => !part.includes("="));

  // Several positional params are an explicit per-rank series, which ultimates
  // use in place of a range. Rendered slash-separated to match how the prompt
  // already writes per-rank cooldowns and costs.
  if (positional.length > 1) {
    const ranks: string[] = [];
    for (const rank of positional) {
      const value = evaluateExpression(rank);
      if (value === null) return null;
      ranks.push(formatNumber(value));
    }
    return ranks.join("/");
  }

  const value = positional[0] ?? "";
  const range = /^\s*(.+?)\s+to\s+(.+?)\s*$/.exec(value);
  if (range) {
    const low = evaluateExpression(range[1]);
    const high = evaluateExpression(range[2]);
    if (low === null || high === null) return null;
    return `${formatNumber(low)} to ${formatNumber(high)}`;
  }

  const single = evaluateExpression(value);
  if (single !== null) return formatNumber(single);

  // Evaluation failed. Anything carrying an arithmetic operator or a paren is
  // arithmetic we could not resolve ("40 +", "(40"), so refuse it: the caller's
  // residual gate screens {}[]|*=# but not + - ( ), and this would otherwise
  // reach a coaching prompt verbatim. Operator-free text is `ap` being used
  // for styling rather than maths, and passes through.
  return /[+\-*/()]/.test(value) ? null : value;
}

/** Trim float noise from evaluated arithmetic: 100 stays "100", 5.625 becomes "5.63". */
function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
