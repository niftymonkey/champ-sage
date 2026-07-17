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

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

const OPERATORS = new Set(["+", "-", "*", "/", "(", ")"]);

function tokenize(expr: string): Token[] | null {
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

  /** factor := "-" factor | "(" expression ")" | number */
  private parseFactor(): number | null {
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
