import { describe, it, expect } from "vitest";
import { coachingResponseSchema } from "./schemas";

/**
 * These tests guard against OpenAI strict-mode structured-output violations.
 *
 * OpenAI's API rejects a schema if any declared property is missing from
 * `required`; optional fields must be nullable + listed in `required`. This
 * bit us hard in 26.04.19 when a newly added optional `buildPath` caused
 * EVERY coaching call (augment, voice, game-plan alike) to fail with a
 * `Invalid schema for response_format` error, since `coachingResponseSchema`
 * is shared. See
 * https://platform.openai.com/docs/guides/structured-outputs.
 */

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean;
};

function assertStrictModeCompatible(schema: Schema, path = "root"): void {
  if (schema.properties) {
    const propKeys = Object.keys(schema.properties);
    const required = schema.required ?? [];
    const missing = propKeys.filter((k) => !required.includes(k));
    expect(
      missing,
      `At ${path}: every property must be listed in 'required' (missing: ${missing.join(", ")})`
    ).toEqual([]);
    expect(
      schema.additionalProperties,
      `At ${path}: 'additionalProperties' must be false`
    ).toBe(false);
    for (const [key, sub] of Object.entries(schema.properties)) {
      assertStrictModeCompatible(sub, `${path}.${key}`);
    }
  }
  if (schema.items) {
    assertStrictModeCompatible(schema.items, `${path}[]`);
  }
}

describe("coachingResponseSchema — OpenAI strict mode compatibility", () => {
  const schema = coachingResponseSchema.jsonSchema as Schema;

  it("lists every declared property in 'required' at every level", () => {
    assertStrictModeCompatible(schema);
  });

  it("declares buildPath as nullable (array or null)", () => {
    const buildPath = schema.properties?.buildPath;
    expect(buildPath?.type).toEqual(["array", "null"]);
  });

  it("declares buildPath.items.targetEnemy as nullable", () => {
    const targetEnemy = schema.properties?.buildPath?.items?.properties
      ?.targetEnemy as Schema | undefined;
    expect(targetEnemy?.type).toEqual(["string", "null"]);
  });
});
