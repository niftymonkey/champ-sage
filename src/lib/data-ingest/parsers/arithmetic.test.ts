import { describe, it, expect } from "vitest";
import { evaluateExpression } from "./arithmetic";

describe("evaluateExpression", () => {
  it("evaluates a bare integer", () => {
    expect(evaluateExpression("35")).toBe(35);
  });

  it("evaluates a bare decimal", () => {
    expect(evaluateExpression("0.25")).toBe(0.25);
  });

  it("evaluates addition and subtraction", () => {
    expect(evaluateExpression("40 + 5 - 15")).toBe(30);
  });

  it("evaluates multiplication, as used by {{ap|50*2}}", () => {
    expect(evaluateExpression("50*2")).toBe(100);
  });

  it("evaluates division, as used by {{ap|45/8}}", () => {
    expect(evaluateExpression("45/8")).toBe(5.625);
  });

  it("honours operator precedence over left-to-right order", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
  });

  it("honours parentheses, as used by {{ap|40*(1+0.4*2)}}", () => {
    expect(evaluateExpression("40*(1+0.4*2)")).toBe(72);
  });

  it("evaluates nested parentheses", () => {
    expect(evaluateExpression("((45+(105-45)*(3/4))/8)*26")).toBe(292.5);
  });

  it("evaluates unary minus", () => {
    expect(evaluateExpression("-5 + 10")).toBe(5);
  });

  it("tolerates surrounding whitespace", () => {
    expect(evaluateExpression("  12 * 3  ")).toBe(36);
  });

  it("returns null for an empty expression", () => {
    expect(evaluateExpression("")).toBeNull();
  });

  it("returns null for identifiers, so unresolved wiki variables quarantine", () => {
    expect(evaluateExpression("b1 * 2")).toBeNull();
  });

  it("returns null for a trailing malformed operand", () => {
    expect(evaluateExpression("(45/8)*26 4")).toBeNull();
  });

  it("returns null for an unbalanced parenthesis", () => {
    expect(evaluateExpression("(40*2")).toBeNull();
  });

  it("returns null for a dangling operator", () => {
    expect(evaluateExpression("40 *")).toBeNull();
  });

  it("returns null for division by zero rather than yielding Infinity", () => {
    expect(evaluateExpression("40/0")).toBeNull();
  });

  it("returns null for percent signs, which are not arithmetic", () => {
    expect(evaluateExpression("50%")).toBeNull();
  });

  describe("recursion bounds", () => {
    // The wiki is user-editable third-party content parsed at ingest, so a
    // pathological expression must fail like any other bad input rather than
    // exhaust the stack and take the whole parse down with it.
    it("returns null for pathologically nested parentheses", () => {
      const expression = "(".repeat(50_000) + "5" + ")".repeat(50_000);
      expect(evaluateExpression(expression)).toBeNull();
    });

    it("returns null for a pathological run of unary minus", () => {
      expect(evaluateExpression("-".repeat(50_000) + "5")).toBeNull();
    });

    it("returns null for pathologically unbalanced open parentheses", () => {
      expect(evaluateExpression("(".repeat(50_000) + "5")).toBeNull();
    });

    it("still evaluates the deepest nesting real wiki data contains", () => {
      // Aurelion Sol's Breath of Light, the deepest real expression at 3 levels.
      expect(evaluateExpression("((45+(105-45)*(3/4))/8)*26")).toBe(292.5);
    });

    it("still evaluates nesting well beyond real data but within the bound", () => {
      expect(evaluateExpression("((((((((((5))))))))))")).toBe(5);
    });

    it("still evaluates a short run of unary minus", () => {
      expect(evaluateExpression("--5")).toBe(5);
    });
  });
});
