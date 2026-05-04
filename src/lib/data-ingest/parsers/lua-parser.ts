import * as luaparse from "luaparse";

/**
 * Parse a Lua table string (as returned by the League Wiki module) into a
 * plain JS object. Uses luaparse for proper AST-based parsing rather than
 * regex, which is necessary because wiki augment descriptions contain
 * double curly braces `}}` that break naive pattern matching.
 */
/**
 * luaparse runs in encodingMode "x-user-defined" and throws on code points
 * outside that subset (e.g. "code unit U+2013 is not allowed in the current
 * encoding mode"). The wiki sporadically emits curly quotes and en/em dashes
 * inside augment descriptions, so every caller of parseLuaTable must run
 * input through this sanitizer first or a single wiki text edit can crash
 * data ingest. Centralized here so any new caller inherits the protection.
 *
 * Curly double quotes are mapped to the escaped sequence `\"` (not bare `"`)
 * because they almost always appear inside double-quoted Lua string literals
 * in the wiki modules; rewriting to a bare `"` would terminate the literal
 * mid-content. extractValue strips the `\` when reading the parsed string.
 */
export function sanitizeForLuaParse(lua: string): string {
  return lua
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '\\"')
    .replace(/[–—]/g, "-");
}

export function parseLuaTable(
  lua: string
): Record<string, Record<string, string | number>> {
  // Strip HTML comment wrapper that the wiki sometimes adds, then normalize
  // unicode characters luaparse cannot handle in x-user-defined mode.
  const cleaned = sanitizeForLuaParse(
    lua.replace(/^--\s*<pre>\s*\n?/, "").replace(/\n?--\s*<\/pre>\s*$/, "")
  );

  const ast = luaparse.parse(cleaned, { encodingMode: "x-user-defined" });
  const result: Record<string, Record<string, string | number>> = {};

  // The AST should be: Chunk > ReturnStatement > TableConstructorExpression
  const returnStmt = ast.body[0];
  if (!returnStmt || returnStmt.type !== "ReturnStatement") return result;

  const table = returnStmt.arguments[0];
  if (!table || table.type !== "TableConstructorExpression") return result;

  for (const field of table.fields) {
    if (field.type !== "TableKey") continue;

    const entryKey = extractString(field.key);
    if (!entryKey) continue;

    if (field.value.type !== "TableConstructorExpression") continue;

    const fields: Record<string, string | number> = {};
    for (const innerField of field.value.fields) {
      if (innerField.type !== "TableKey") continue;
      const fieldName = extractString(innerField.key);
      if (!fieldName) continue;

      const value = extractValue(innerField.value);
      if (value !== null) {
        fields[fieldName] = value;
      }
    }

    result[entryKey] = fields;
  }

  return result;
}

function extractString(node: luaparse.Node): string | null {
  if (node.type === "StringLiteral") {
    // raw includes quotes, so strip them
    return node.raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return null;
}

function extractValue(node: luaparse.Node): string | number | null {
  if (node.type === "StringLiteral") {
    return node.raw.slice(1, -1).replace(/\\"/g, '"');
  }
  if (node.type === "NumericLiteral") {
    return node.value;
  }
  return null;
}
