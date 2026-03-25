/**
 * Strip League Wiki markup from augment descriptions, producing plain text.
 *
 * Processes templates inside-out (innermost first) to handle nesting like
 * {{as|{{fd|3.5}}% bonus AD}}. Each iteration resolves the innermost
 * templates until none remain.
 *
 * Template types handled:
 * - {{as|content}} / {{as|content|stat}} → content
 * - {{tip|key|display}} → display
 * - {{pp|values|...}} → first param (values)
 * - {{fd|number}} → number (formatted decimal)
 * - {{ii|Item}} / {{ii|Item|opts}} → Item (item name link)
 * - {{iis|Item}} → Item (possessive item link)
 * - {{sbc|text}} → text (section/stat block header)
 * - {{cai|Ability|Champion}} → Ability (champion ability)
 * - {{ai|Ability|Champion}} → Ability (ability reference)
 * - {{g|number}} → number gold
 * - {{nie|name}} → name (named item effect)
 * - {{si|spell}} → spell (summoner spell/item)
 * - {{bi|buff}} → buff (buff name)
 * - {{rd|val1|val2|...}} → val1 (ranged/reduced, keeps first)
 * - {{ap|expr}} → expr (arithmetic/percentage)
 * - {{ft|simple|detailed}} → simple (footnote, keeps first param)
 * - {{other|...|display}} → display (last param fallback)
 * - [[Page|display]] → display
 * - [[Page]] → Page
 * - '''bold''' → bold
 * - ''italic'' → italic
 * - HTML tags → removed (with space insertion for block-level tags)
 * - HTML comments → removed
 */
export function stripWikiMarkup(text: string): string {
  let result = text;

  // Strip HTML comments first (before tag stripping)
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  // Strip HTML block/list tags with space to preserve word boundaries
  result = result.replace(/<\/?(ul|ol|li|br|p|div)\s*\/?>/gi, " ");

  // Strip remaining HTML tags
  result = result.replace(/<[^>]+>/g, "");

  // Strip [[[File:...|...] wiki file references (malformed triple-bracket)
  result = result.replace(/\[\[\[File:[^\]]*\]/g, "");

  // Strip [[File:...|...]] standard wiki file embeds
  result = result.replace(/\[\[File:[^\]]*\]\]/g, "");

  // Strip {{#invoke:...}} and {{#expr:...}} parser functions
  result = result.replace(/\{\{#\w+:[^}]*\}\}/g, "");

  // Process templates inside-out: repeatedly resolve innermost templates
  // (those containing no nested {{ }}) until no templates remain.
  // Safety limit prevents infinite loops on malformed input.
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (result.includes("{{") && iterations < MAX_ITERATIONS) {
    const before = result;

    // Match innermost templates: {{ ... }} where ... contains no {{ or }}
    result = result.replace(/\{\{([^{}]*)\}\}/g, (_match, content: string) =>
      resolveTemplate(content)
    );

    // If nothing changed, we have malformed templates — break to avoid looping
    if (result === before) break;
    iterations++;
  }

  // Strip [[Page|display]] → display
  result = result.replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, "$1");

  // Strip [[Page]] → Page
  result = result.replace(/\[\[([^\]]*)\]\]/g, "$1");

  // Strip bold '''text''' → text
  result = result.replace(/'''([^']*?)'''/g, "$1");

  // Strip italic ''text'' → italic
  result = result.replace(/''([^']*?)''/g, "$1");

  // Strip bare pipe annotations from Lua data: "25%|heal" → "25% heal"
  result = result.replace(/\|/g, " ");

  // Strip meta-references that don't convey useful info
  result = result.replace(/Damage calculated before modifiers/gi, "damage");
  result = result.replace(/Estimated pre-mitigation/gi, "");

  // Collapse multiple spaces left by removals
  result = result.replace(/ {2,}/g, " ");

  return result.trim();
}

/**
 * Resolve a single (innermost, no nesting) template.
 * Input is the content between {{ and }}, e.g., "ii|The Golden Spatula".
 */
function resolveTemplate(content: string): string {
  const parts = content.split("|");
  const templateName = parts[0].trim().toLowerCase();

  switch (templateName) {
    // Stat references: {{as|content}} or {{as|content|stat_type}}
    case "as":
      return parts[1] ?? "";

    // Tooltips: {{tip|key|display}} or {{tip|key}} (single-param = key as display)
    case "tip":
      return parts[2] ?? parts[1] ?? "";

    // Per-level values: {{pp|values|...}} — keep first value param.
    // When first param is a named option like "key=%", skip to next param.
    case "pp": {
      const valueParam = parts[1] ?? "";
      if (valueParam.includes("=") && parts.length > 2) {
        return parts[2] ?? "";
      }
      return valueParam;
    }

    // Formatted decimal: {{fd|number}}
    case "fd":
      return parts[1] ?? "";

    // Item name links: {{ii|Item}} or {{ii|Item|icononly=yes}}
    case "ii":
      return parts[1] ?? "";

    // Possessive item links: {{iis|Item}}
    case "iis":
      return parts[1] ?? "";

    // Section/stat block headers: {{sbc|text}}
    case "sbc":
      return parts[1] ?? "";

    // Champion ability: {{cai|Ability|Champion}} → Ability
    case "cai":
      return parts[1] ?? "";

    // Ability reference: {{ai|Ability|Champion}} → Ability
    case "ai":
      return parts[1] ?? "";

    // Gold values: {{g|number}} → "number gold"
    case "g":
      return parts[1] ? `${parts[1]} gold` : "";

    // Named item effects: {{nie|name}}
    case "nie":
      return parts[1] ?? "";

    // Summoner spell/item: {{si|spell}}
    case "si":
      return parts[1] ?? "";

    // Buff names: {{bi|buff}}
    case "bi":
      return parts[1] ?? "";

    // Ranged/reduced values: {{rd|val1|val2|...}} → val1
    case "rd":
      return parts[1] ?? "";

    // Arithmetic/percentage: {{ap|expr}}
    case "ap":
      return parts[1] ?? "";

    // Footnotes: {{ft|simple version|detailed version}} → simple version
    case "ft":
      return parts[1] ?? "";

    // Recurring: {{recurring|number}} → number (used inside fd)
    case "recurring":
      return parts[1] ?? "";

    default:
      // Unknown template with params — return last param (most likely display text)
      if (parts.length > 1) {
        return parts[parts.length - 1];
      }
      // No params — drop entirely
      return "";
  }
}
