/**
 * Strip League Wiki markup from augment descriptions, producing plain text.
 *
 * Handles these common patterns:
 * - {{as|content}} → content
 * - {{tip|key|display}} → display
 * - {{pp|values}} → values
 * - {{other|...}} → last parameter (display text)
 * - [[Page|display]] → display
 * - [[Page]] → Page
 * - '''bold''' → bold
 * - ''italic'' → italic
 * - <br>, <br/>, and other HTML tags → removed
 */
export function stripWikiMarkup(text: string): string {
  let result = text;

  // Strip HTML tags
  result = result.replace(/<[^>]+>/g, "");

  // Strip [[[File:...|...] wiki file references (malformed triple-bracket)
  result = result.replace(/\[\[\[File:[^\]]*\]/g, "");

  // Strip [[File:...|...]] standard wiki file embeds
  result = result.replace(/\[\[File:[^\]]*\]\]/g, "");

  // Strip {{tip|key|display}} → display (second param)
  result = result.replace(/\{\{tip\|[^|]*\|([^}]*)\}\}/g, "$1");

  // Strip {{as|content}} → content
  result = result.replace(/\{\{as\|([^}]*)\}\}/g, "$1");

  // Strip {{pp|values}} → values
  result = result.replace(/\{\{pp\|([^}]*)\}\}/g, "$1");

  // Strip any remaining {{template|...|display}} → last param
  result = result.replace(/\{\{[^|]*\|(?:[^|]*\|)*([^}]*)\}\}/g, "$1");

  // Strip any remaining {{template}} with no params
  result = result.replace(/\{\{[^}]*\}\}/g, "");

  // Strip [[Page|display]] → display
  result = result.replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, "$1");

  // Strip [[Page]] → Page
  result = result.replace(/\[\[([^\]]*)\]\]/g, "$1");

  // Strip bold '''text''' → text
  result = result.replace(/'''([^']*?)'''/g, "$1");

  // Strip italic ''text'' → text
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
