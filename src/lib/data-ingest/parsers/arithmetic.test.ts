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
    //
    // Every input here stays under the 512-character length bound, so the depth
    // guard is the only thing that can reject them. Inputs long enough to trip
    // the length bound first belong in the "expression size bound" suite: they
    // pass whether or not the parser bounds its recursion at all.
    it("returns null for parentheses nested past the depth bound", () => {
      const expression = "(".repeat(40) + "5" + ")".repeat(40);
      expect(expression.length).toBeLessThan(512);
      expect(evaluateExpression(expression)).toBeNull();
    });

    it("returns null for a run of unary minus past the depth bound", () => {
      const expression = "-".repeat(40) + "5";
      expect(expression.length).toBeLessThan(512);
      expect(evaluateExpression(expression)).toBeNull();
    });

    it("returns null for unbalanced open parentheses past the depth bound", () => {
      const expression = "(".repeat(40) + "5";
      expect(expression.length).toBeLessThan(512);
      expect(evaluateExpression(expression)).toBeNull();
    });

    it("still evaluates the deepest nesting real wiki data contains", () => {
      // Aurelion Sol's Breath of Light, the deepest real expression at 3 levels.
      expect(evaluateExpression("((45+(105-45)*(3/4))/8)*26")).toBe(292.5);
    });

    it("still evaluates nesting well beyond real data but within the bound", () => {
      expect(evaluateExpression("((((((((((5))))))))))")).toBe(5);
    });

    it("brackets the cutoff between accepted and rejected nesting", () => {
      // Both inputs are far shorter than the length bound, so the only thing
      // that can tell them apart is the depth bound. Rejecting the deeper one
      // while accepting the shallower one is what proves the guard is live.
      const withinBound = "(".repeat(31) + "5" + ")".repeat(31);
      const pastBound = "(".repeat(40) + "5" + ")".repeat(40);

      expect(evaluateExpression(withinBound)).toBe(5);
      expect(evaluateExpression(pastBound)).toBeNull();
    });

    it("still evaluates a short run of unary minus", () => {
      expect(evaluateExpression("--5")).toBe(5);
    });
  });
});

describe("expression size bound", () => {
  it("rejects an oversized expression instead of tokenizing it", () => {
    // Wiki text is user-editable, so expression length is untrusted input.
    // The depth bound stops the parser recursing; this stops a single huge
    // page from making us tokenize megabytes at ingest. Real expressions top
    // out around 50 characters (Aurelion Sol's Breath of Light is the
    // deepest), so anything at this scale is pathological, not data.
    const oversized = `1${"+1".repeat(50_000)}`;

    expect(evaluateExpression(oversized)).toBeNull();
  });

  it("still evaluates an expression comfortably larger than real wiki data", () => {
    // Guard the bound from being set so tight it rejects genuine content.
    const realistic = "((45+(105-45)*(3/4))/8)*26";

    expect(evaluateExpression(realistic)).toBe(292.5);
  });
});
