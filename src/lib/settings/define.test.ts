import { describe, it, expect } from "vitest";
import {
  defineBoolean,
  defineEnum,
  defineNumber,
  defineString,
} from "./define";

describe("defineBoolean", () => {
  const setting = defineBoolean({
    key: "x",
    storageKey: "test.x",
    label: "X",
    description: "An X.",
    defaultValue: false,
  });

  it("stamps type 'boolean' on the descriptor", () => {
    expect(setting.type).toBe("boolean");
  });

  it("parse(true) returns true", () => {
    expect(setting.parse(true)).toBe(true);
  });

  it("parse(false) returns false", () => {
    expect(setting.parse(false)).toBe(false);
  });

  it("parse(non-boolean) returns the default", () => {
    expect(setting.parse("yes")).toBe(false);
    expect(setting.parse(1)).toBe(false);
    expect(setting.parse(null)).toBe(false);
    expect(setting.parse(undefined)).toBe(false);
    expect(setting.parse({})).toBe(false);
  });
});

describe("defineString", () => {
  const setting = defineString({
    key: "name",
    storageKey: "test.name",
    label: "Name",
    description: "A name.",
    defaultValue: "default",
  });

  it("stamps type 'string'", () => {
    expect(setting.type).toBe("string");
  });

  it("parse(string) returns the string", () => {
    expect(setting.parse("hello")).toBe("hello");
  });

  it("parse(non-string) returns the default", () => {
    expect(setting.parse(42)).toBe("default");
    expect(setting.parse(true)).toBe("default");
    expect(setting.parse(null)).toBe("default");
  });

  it("respects maxLength when present", () => {
    const capped = defineString({
      key: "short",
      storageKey: "test.short",
      label: "Short",
      description: "Short.",
      defaultValue: "ok",
      maxLength: 3,
    });
    expect(capped.parse("hi")).toBe("hi");
    expect(capped.parse("toolong")).toBe("ok");
  });
});

describe("defineNumber", () => {
  const setting = defineNumber({
    key: "n",
    storageKey: "test.n",
    label: "N",
    description: "A number.",
    defaultValue: 5,
  });

  it("stamps type 'number'", () => {
    expect(setting.type).toBe("number");
  });

  it("parse(number) returns the number", () => {
    expect(setting.parse(3)).toBe(3);
    expect(setting.parse(0)).toBe(0);
    expect(setting.parse(-2.5)).toBe(-2.5);
  });

  it("parse(non-finite) returns default", () => {
    expect(setting.parse(NaN)).toBe(5);
    expect(setting.parse(Infinity)).toBe(5);
    expect(setting.parse("3")).toBe(5);
    expect(setting.parse(null)).toBe(5);
  });

  it("clamps to default when outside [min, max]", () => {
    const bounded = defineNumber({
      key: "b",
      storageKey: "test.b",
      label: "B",
      description: "B.",
      defaultValue: 5,
      min: 0,
      max: 10,
    });
    expect(bounded.parse(5)).toBe(5);
    expect(bounded.parse(-1)).toBe(5);
    expect(bounded.parse(11)).toBe(5);
    expect(bounded.parse(0)).toBe(0);
    expect(bounded.parse(10)).toBe(10);
  });
});

describe("defineEnum", () => {
  const setting = defineEnum<"brief" | "pirate">({
    key: "voice",
    storageKey: "test.voice",
    label: "Voice",
    description: "Coach voice.",
    defaultValue: "brief",
    options: [
      { value: "brief", label: "Brief" },
      { value: "pirate", label: "Pirate" },
    ],
  });

  it("stamps type 'enum'", () => {
    expect(setting.type).toBe("enum");
  });

  it("parse(allowed value) returns it", () => {
    expect(setting.parse("brief")).toBe("brief");
    expect(setting.parse("pirate")).toBe("pirate");
  });

  it("parse(disallowed value) returns default", () => {
    expect(setting.parse("formal")).toBe("brief");
    expect(setting.parse(42)).toBe("brief");
    expect(setting.parse(null)).toBe("brief");
  });

  it("exposes the options list verbatim for UI rendering", () => {
    expect(setting.options).toEqual([
      { value: "brief", label: "Brief" },
      { value: "pirate", label: "Pirate" },
    ]);
  });
});
