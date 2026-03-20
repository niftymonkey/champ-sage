import { describe, it, expect } from "vitest";
import { stripWikiMarkup } from "./wiki-markup";

describe("stripWikiMarkup", () => {
  it("strips bold markers", () => {
    expect(stripWikiMarkup("'''bonus''' attack damage")).toBe(
      "bonus attack damage"
    );
  });

  it("strips italic markers", () => {
    expect(stripWikiMarkup("''italic'' text")).toBe("italic text");
  });

  it("strips {{as|...}} templates (stat references)", () => {
    expect(stripWikiMarkup("{{as|'''bonus''' attack damage}}")).toBe(
      "bonus attack damage"
    );
  });

  it("strips {{tip|...|...}} templates (tooltips)", () => {
    expect(stripWikiMarkup("{{tip|immobilize|Immobilizing}} a target")).toBe(
      "Immobilizing a target"
    );
  });

  it("strips {{pp|...}} templates (per-level values)", () => {
    expect(stripWikiMarkup("deals {{pp|10;20;30}} damage")).toBe(
      "deals 10;20;30 damage"
    );
  });

  it("strips [[link]] wiki links, keeping display text", () => {
    expect(stripWikiMarkup("[[Attack damage|AD]]")).toBe("AD");
  });

  it("strips [[simple link]] wiki links", () => {
    expect(stripWikiMarkup("[[Attack damage]]")).toBe("Attack damage");
  });

  it("handles multiple templates in one string", () => {
    const input =
      "{{tip|immobilize|Immobilizing}} grants {{as|'''50''' armor}} for '''3''' seconds.";
    const expected = "Immobilizing grants 50 armor for 3 seconds.";
    expect(stripWikiMarkup(input)).toBe(expected);
  });

  it("strips nested bold inside templates", () => {
    expect(stripWikiMarkup("{{as|'''100%''' bonus AD}}")).toBe("100% bonus AD");
  });

  it("returns plain text unchanged", () => {
    expect(stripWikiMarkup("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(stripWikiMarkup("")).toBe("");
  });

  it("strips HTML-like tags", () => {
    expect(stripWikiMarkup("<br>new line<br/>")).toBe("new line");
  });

  it("strips [[[File:...] wiki file references", () => {
    expect(
      stripWikiMarkup("[[[File:High Roller set mayhem.png|25px|link=]")
    ).toBe("");
  });

  it("strips file references embedded in text", () => {
    expect(
      stripWikiMarkup(
        "Transmute: Prismatic [[[File:High Roller set mayhem.png|25px|link=]"
      )
    ).toBe("Transmute: Prismatic");
  });

  it("strips [[File:...]] standard wiki file embeds", () => {
    expect(stripWikiMarkup("Set: [[File:icon.png|20px]] Enforcers")).toBe(
      "Set: Enforcers"
    );
  });
});
