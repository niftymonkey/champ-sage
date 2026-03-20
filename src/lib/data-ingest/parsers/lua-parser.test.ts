import { describe, it, expect } from "vitest";
import { parseLuaTable } from "./lua-parser";

describe("parseLuaTable", () => {
  it("parses a simple Lua table with string values", () => {
    const lua = `return {
      ["Foo"] = {
        ["name"] = "Foo Bar",
        ["tier"] = "Gold",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(result).toEqual({
      Foo: { name: "Foo Bar", tier: "Gold" },
    });
  });

  it("parses multiple entries", () => {
    const lua = `return {
      ["ADAPt"] = {
        ["description"] = "Convert all bonus AD into AP.",
        ["tier"] = "Silver",
        ["set"] = "-",
      },
      ["Adamant"] = {
        ["description"] = "Immobilizing grants shield.",
        ["tier"] = "Silver",
        ["set"] = "-",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["ADAPt"].description).toBe("Convert all bonus AD into AP.");
    expect(result["Adamant"].tier).toBe("Silver");
  });

  it("handles escaped quotes in strings", () => {
    const lua = `return {
      ["Test"] = {
        ["description"] = "Deal \\"bonus\\" damage.",
        ["tier"] = "Gold",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(result["Test"].description).toBe('Deal "bonus" damage.');
  });

  it("handles multiline descriptions", () => {
    const lua = `return {
      ["Test"] = {
        ["description"] = "Line one. Line two.",
        ["tier"] = "Prismatic",
        ["set"] = "-",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(result["Test"].description).toBe("Line one. Line two.");
  });

  it("handles numeric values", () => {
    const lua = `return {
      ["Test"] = {
        ["count"] = 5,
        ["name"] = "Test",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(result["Test"].count).toBe(5);
  });

  it("handles empty table", () => {
    const lua = "return {}";
    const result = parseLuaTable(lua);
    expect(result).toEqual({});
  });

  it("handles descriptions containing double curly braces (wiki templates)", () => {
    const lua = `return {
      ["Blunt Force"] = {
        ["description"] = "Increases {{as|attack damage}} by {{as|20%|AD}}.",
        ["tier"] = "Silver",
        ["set"] = "-",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(result["Blunt Force"].tier).toBe("Silver");
    expect(result["Blunt Force"].set).toBe("-");
    expect(result["Blunt Force"].description).toContain("{{as|attack damage}}");
  });

  it("handles complex real-world wiki entries with nested templates", () => {
    const lua = `return {
      ["Buff Buddies"] = {
        ["description"] = "Grants the {{bi|Crest of Cinders}} and {{bi|Crest of Insight}} buffs permanently.<br><br>{{sbc|Crest of Cinders:}} Empowers attacks to {{tip|slow}} by {{rd|10;15;20|5;7.5;10|levels=1;6;11|key=%|pp=true}} for 3 seconds.",
        ["tier"] = "Gold",
        ["set"] = "[[File:Archmage set mayhem.png|30px|link=]] [[ARAM:_Mayhem/Augment_Sets|Archmage]]",
      },
      ["Deft"] = {
        ["description"] = "Grants {{as|60% '''bonus''' attack speed}}.",
        ["tier"] = "Prismatic",
        ["set"] = "-",
      },
    }`;
    const result = parseLuaTable(lua);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["Buff Buddies"].tier).toBe("Gold");
    expect(result["Buff Buddies"].set).toContain("Archmage");
    expect(result["Deft"].tier).toBe("Prismatic");
  });

  it("strips the return keyword and handles whitespace", () => {
    const lua = `  return  {
      ["A"] = {
        ["x"] = "y",
      },
    }  `;
    const result = parseLuaTable(lua);
    expect(result["A"].x).toBe("y");
  });
});
