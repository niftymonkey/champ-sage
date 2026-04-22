import { describe, it, expect } from "vitest";
import { coachingResponseSchema } from "./schemas";
import { augmentFitSchema } from "./features/augment-fit/schema";
import { itemRecSchema } from "./features/item-rec/schema";
import { voiceQuerySchema } from "./features/voice-query/schema";
import { createGamePlanSchema } from "./features/game-plan/schema";

/**
 * These tests guard against OpenAI strict-mode structured-output violations.
 *
 * OpenAI's API rejects a schema if any declared property is missing from
 * `required`; optional fields must be nullable + listed in `required`. This
 * bit us hard in 26.04.19 when a newly added optional `buildPath` caused
 * EVERY coaching call (augment, voice, game-plan alike) to fail with a
 * `Invalid schema for response_format` error, since `coachingResponseSchema`
 * was shared. See
 * https://platform.openai.com/docs/guides/structured-outputs.
 *
 * Every per-feature schema goes through the same tree-walker assertion so
 * new features can't regress the contract.
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

const perFeatureSchemas: Array<{
  name: string;
  schema: { jsonSchema: unknown };
}> = [
  { name: "augmentFitSchema", schema: augmentFitSchema },
  { name: "itemRecSchema", schema: itemRecSchema },
  { name: "voiceQuerySchema", schema: voiceQuerySchema },
  {
    name: "createGamePlanSchema(…)",
    schema: createGamePlanSchema(["Example Item", "Another Item"]),
  },
  {
    name: "coachingResponseSchema (legacy/eval)",
    schema: coachingResponseSchema,
  },
];

describe("per-feature schemas — OpenAI strict mode compatibility", () => {
  for (const { name, schema } of perFeatureSchemas) {
    it(`${name} lists every declared property in 'required' at every level`, () => {
      assertStrictModeCompatible(schema.jsonSchema as Schema);
    });
  }
});

describe("game-plan schema — #109 structural guardrails", () => {
  it("declares buildPath as a required non-nullable array", () => {
    const schema = createGamePlanSchema(["Example Item"]).jsonSchema as Schema;
    const buildPath = schema.properties?.buildPath;
    // Not nullable any more — game-plan always returns a buildPath.
    expect(buildPath?.type).toEqual("array");
    expect(schema.required).toContain("buildPath");
  });

  it("declares buildPath.items.targetEnemy as nullable", () => {
    const schema = createGamePlanSchema(["Example Item"]).jsonSchema as Schema;
    const targetEnemy = schema.properties?.buildPath?.items?.properties
      ?.targetEnemy as Schema | undefined;
    expect(targetEnemy?.type).toEqual(["string", "null"]);
  });

  it("applies a string enum to buildPath.items.name when the item catalog fits the enum size limit", () => {
    const itemNames = [
      "Rabadon's Deathcap",
      "Luden's Companion",
      "Zhonya's Hourglass",
    ];
    const schema = createGamePlanSchema(itemNames).jsonSchema as Schema;
    const nameSchema = schema.properties?.buildPath?.items?.properties
      ?.name as {
      enum?: string[];
    };
    expect(nameSchema?.enum).toEqual(itemNames);
  });

  it("falls back to free-string when the catalog exceeds the enum limit", () => {
    const tooManyItems = Array.from({ length: 501 }, (_, i) => `Item ${i}`);
    const schema = createGamePlanSchema(tooManyItems).jsonSchema as Schema;
    const nameSchema = schema.properties?.buildPath?.items?.properties
      ?.name as {
      enum?: string[];
    };
    expect(nameSchema?.enum).toBeUndefined();
  });
});
