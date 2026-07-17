/**
 * Safe evaluator for the small arithmetic expressions the League Wiki embeds in
 * ability templates, e.g. `{{ap|40*0.4 to 120*0.4}}` or `{{#expr:(1.75-1)*100}}`.
 *
 * The wiki stores derived numbers as unevaluated expressions rather than
 * literals, so scaling text is unreadable until they are resolved. Supports
 * `+ - * /`, unary minus, and parentheses over decimal literals. Anything else
 * (identifiers, function calls, malformed input, division by zero) returns null
 * so callers can quarantine rather than surface a half-resolved expression.
 *
 * Hand-rolled rather than delegated to a library because the grammar is four
 * operators wide and the alternative (eval/Function) would execute arbitrary
 * wiki-authored text in-process.
 */
export function evaluateExpression(expr: string): number | null {
  const tokens = tokenize(expr);
  if (!tokens) return null;

  const parser = new Parser(tokens);
  const value = parser.parseExpression();
  if (value === null) return null;
  // Trailing tokens mean the input was not a single well-formed expression
  // (e.g. "(45/8)*26 4"), which is corrupt wiki data rather than arithmetic.
  if (!parser.atEnd()) return null;
  if (!Number.isFinite(value)) return null;

  return value;
}

/**
 * How deep `factor` may nest before an expression is treated as malformed.
 *
 * Parenthesis nesting and unary-minus runs both recurse, so an unbounded parser
 * on user-editable wiki text can exhaust the stack. A stack overflow would not
 * quarantine one stat: it would escape the whole ability parse and cost every
 * champion their scaling for the session. The deepest expression in real wiki
 * data nests 3 levels (Aurelion Sol's Breath of Light), so this leaves an order
 * of magnitude of headroom while staying far below any stack limit.
 */
const MAX_PARSE_DEPTH = 32;

/**
 * How long an expression may be before it is treated as malformed.
 *
 * Expression length is untrusted input for the same reason nesting depth is:
 * the wiki is user-editable and we parse it at ingest for the whole roster.
 * `MAX_PARSE_DEPTH` stops the parser recursing, but a single flat megabyte of
 * `1+1+1+...` would still be tokenized in full. The longest real expression in
 * wiki data is ~50 characters (Aurelion Sol's Breath of Light), so this keeps
 * an order of magnitude of headroom while making pathological input cheap to
 * reject.
 */
const MAX_EXPRESSION_LENGTH = 512;

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

const OPERATORS = new Set(["+", "-", "*", "/", "(", ")"]);

function tokenize(expr: string): Token[] | null {
  if (expr.length > MAX_EXPRESSION_LENGTH) return null;

  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (OPERATORS.has(char)) {
      tokens.push({ kind: "op", value: char });
      i++;
      continue;
    }

    const numberMatch = /^\d*\.?\d+/.exec(expr.slice(i));
    if (numberMatch) {
      tokens.push({ kind: "number", value: Number(numberMatch[0]) });
      i += numberMatch[0].length;
      continue;
    }

    // Anything else (identifiers, %, stray punctuation) is not arithmetic.
    return null;
  }

  return tokens.length > 0 ? tokens : null;
}

class Parser {
  private position = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  /** expression := term (("+" | "-") term)* */
  parseExpression(): number | null {
    let left = this.parseTerm();
    if (left === null) return null;

    while (this.peekOperator("+") || this.peekOperator("-")) {
      const operator = this.next();
      const right = this.parseTerm();
      if (right === null) return null;
      left = operator === "+" ? left + right : left - right;
    }

    return left;
  }

  /** term := factor (("*" | "/") factor)* */
  private parseTerm(): number | null {
    let left = this.parseFactor();
    if (left === null) return null;

    while (this.peekOperator("*") || this.peekOperator("/")) {
      const operator = this.next();
      const right = this.parseFactor();
      if (right === null) return null;
      if (operator === "/" && right === 0) return null;
      left = operator === "*" ? left * right : left / right;
    }

    return left;
  }

  /**
   * Bounded entry point for `factor`, the only rule that recurses. Exceeding
   * the depth is a normal parse failure, so a pathological expression flows
   * into the caller's existing quarantine path instead of throwing.
   */
  private parseFactor(): number | null {
    if (this.depth >= MAX_PARSE_DEPTH) return null;
    this.depth++;
    const value = this.parseFactorAtDepth();
    this.depth--;
    return value;
  }

  /** factor := "-" factor | "(" expression ")" | number */
  private parseFactorAtDepth(): number | null {
    if (this.peekOperator("-")) {
      this.next();
      const operand = this.parseFactor();
      return operand === null ? null : -operand;
    }

    if (this.peekOperator("(")) {
      this.next();
      const inner = this.parseExpression();
      if (inner === null) return null;
      if (!this.peekOperator(")")) return null;
      this.next();
      return inner;
    }

    const token = this.tokens[this.position];
    if (!token || token.kind !== "number") return null;
    this.position++;
    return token.value;
  }

  private peekOperator(operator: string): boolean {
    const token = this.tokens[this.position];
    return (
      token !== undefined && token.kind === "op" && token.value === operator
    );
  }

  private next(): string {
    const token = this.tokens[this.position];
    this.position++;
    return token !== undefined && token.kind === "op" ? token.value : "";
  }
}
