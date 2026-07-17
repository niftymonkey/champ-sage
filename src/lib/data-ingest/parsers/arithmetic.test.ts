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
});
