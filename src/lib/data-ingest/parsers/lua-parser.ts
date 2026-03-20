import * as luaparse from "luaparse";

/**
 * Parse a Lua table string (as returned by the League Wiki module) into a
 * plain JS object. Uses luaparse for proper AST-based parsing rather than
 * regex, which is necessary because wiki augment descriptions contain
 * double curly braces `}}` that break naive pattern matching.
 */
export function parseLuaTable(
  lua: string
): Record<string, Record<string, string | number>> {
  // Strip HTML comment wrapper that the wiki sometimes adds
  const cleaned = lua
    .replace(/^--\s*<pre>\s*\n?/, "")
    .replace(/\n?--\s*<\/pre>\s*$/, "");

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
