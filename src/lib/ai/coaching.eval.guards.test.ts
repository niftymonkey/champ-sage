/**
 * Anti-drift guards for the coaching eval harness (#112).
 *
 * The eval is a regression net only if it exercises the same code path the
 * app runs in production. These tests assert source-level invariants that
 * would fail loudly if anyone re-introduces a parallel implementation:
 *
 * - `generateText` direct call → must go through `session.ask` instead.
 * - `coachingResponseSchema` / `buildGameSystemPrompt` / `buildFeatureRules`
 *   → these are the pre-#108 monolithic seams. The eval must not bypass
 *   per-feature schemas/prompts by reaching for them.
 * - The eval must import `buildBaseContext` and `createMatchSession`
 *   so the system prompt and dispatch path stay aligned with production.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const evalSource = readFileSync(
  resolve(__dirname, "coaching.eval.ts"),
  "utf-8"
);

describe("coaching.eval.ts anti-drift guards", () => {
  describe("forbidden references (would resurrect parallel implementation)", () => {
    // Match call/use sites only — bare token mentions in comments are
    // benign and shouldn't trip the guard. The patterns target the shapes
    // these symbols take when actually wired in: a function call, a schema
    // passed to a config, etc.
    const forbidden: Array<{ token: string; pattern: RegExp; reason: string }> =
      [
        {
          token: "generateText",
          pattern: /\bgenerateText\s*\(/,
          reason:
            "the eval must not call generateText directly — route through session.ask so production wiring (race-with-retry, history append, summarizeForHistory) is exercised",
        },
        {
          token: "coachingResponseSchema",
          pattern: /\bcoachingResponseSchema\b/,
          reason:
            "the shared schema is a compat shim retained only for legacy callers — per-feature schemas come from the feature modules via session.ask",
        },
        {
          token: "buildGameSystemPrompt",
          pattern: /\bbuildGameSystemPrompt\s*\(/,
          reason:
            "the pre-#108 monolithic system prompt builder is replaced by buildBaseContext + per-feature task prompts",
        },
        {
          token: "buildFeatureRules",
          pattern: /\bbuildFeatureRules\s*\(/,
          reason:
            "feature rules now live inside per-feature task prompts; calling buildFeatureRules directly bypasses that ownership",
        },
      ];

    for (const { token, pattern, reason } of forbidden) {
      it(`does not reference ${token}`, () => {
        expect(
          evalSource,
          `eval harness contains "${token}". ${reason}`
        ).not.toMatch(pattern);
      });
    }
  });

  describe("required imports (production code path)", () => {
    const required: Array<{ token: string; reason: string }> = [
      {
        token: "buildBaseContext",
        reason:
          "the eval must build its system prompt via buildBaseContext so it stays byte-equal to what production uses",
      },
      {
        token: "createMatchSession",
        reason:
          "the eval must dispatch through createMatchSession so model-injection + session.ask + history wiring all run",
      },
      {
        token: "session.ask",
        reason:
          "the eval's task() must invoke session.ask(feature, input) — that's the production entry point being validated",
      },
    ];

    for (const { token, reason } of required) {
      it(`imports/uses ${token}`, () => {
        expect(
          evalSource,
          `eval harness is missing "${token}". ${reason}`
        ).toMatch(new RegExp(token.replace(".", "\\.")));
      });
    }

    // Call-shape guard: buildBaseContext must be called with the three
    // production inputs (mode, gameData, gameState). If the eval ever wraps
    // or narrows them, this regex fails. behavioral verification of
    // buildBaseContext itself lives in base-context.test.ts — not here.
    // Lookaheads make the assertion order-independent — the three keys can
    // appear in any order inside the object literal without breaking CI.
    it("calls buildBaseContext with { mode, gameData, gameState }", () => {
      expect(evalSource).toMatch(
        /buildBaseContext\(\s*\{(?=[^}]*\bmode\b)(?=[^}]*\bgameData\b)(?=[^}]*\bgameState\b)[^}]*\}\s*\)/
      );
    });
  });
});
