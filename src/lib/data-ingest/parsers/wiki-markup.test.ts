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

  it("strips bare pipe annotations from Lua data", () => {
    expect(stripWikiMarkup("25%|heal and shield power")).toBe(
      "25% heal and shield power"
    );
    expect(stripWikiMarkup("Firecrackers|fury")).toBe("Firecrackers fury");
    expect(stripWikiMarkup("100 item haste|ability haste")).toBe(
      "100 item haste ability haste"
    );
  });

  it("strips meta-references like Damage calculated before modifiers", () => {
    expect(
      stripWikiMarkup("deal Damage calculated before modifiers to enemies")
    ).toBe("deal damage to enemies");
  });

  it("strips Estimated pre-mitigation meta-reference", () => {
    expect(stripWikiMarkup("deal Estimated pre-mitigation damage")).toBe(
      "deal damage"
    );
  });

  // --- New template types ---

  it("strips {{ii|Item}} item name templates", () => {
    expect(stripWikiMarkup("you receive {{ii|The Golden Spatula}}")).toBe(
      "you receive The Golden Spatula"
    );
  });

  it("strips {{ii|Item|icononly=yes}} keeping item name", () => {
    expect(stripWikiMarkup("{{ii|Rabadon's Deathcap|icononly=yes}}")).toBe(
      "Rabadon's Deathcap"
    );
  });

  it("strips {{iis|Item}} possessive item templates", () => {
    expect(
      stripWikiMarkup("the cooldown of {{iis|Zhonya's Hourglass}} Stasis")
    ).toBe("the cooldown of Zhonya's Hourglass Stasis");
  });

  it("strips {{fd|number}} formatted decimal templates", () => {
    expect(stripWikiMarkup("deals {{fd|0.5}}% damage")).toBe(
      "deals 0.5% damage"
    );
    expect(stripWikiMarkup("over {{fd|5.5}} seconds")).toBe("over 5.5 seconds");
  });

  it("strips {{sbc|text}} section header templates", () => {
    expect(stripWikiMarkup("{{sbc|Quest:}} Score 18 takedowns")).toBe(
      "Quest: Score 18 takedowns"
    );
    expect(stripWikiMarkup("{{sbc|Reward:}} You get a prize")).toBe(
      "Reward: You get a prize"
    );
  });

  it("strips {{cai|Ability|Champion}} champion ability templates", () => {
    expect(
      stripWikiMarkup("cast {{cai|Ring of Frost|Lissandra}} around you")
    ).toBe("cast Ring of Frost around you");
  });

  it("strips {{ai|Ability|Champion}} ability templates", () => {
    expect(
      stripWikiMarkup("{{ai|Spirit Rush|Ahri}} and {{ai|Death Lotus|Katarina}}")
    ).toBe("Spirit Rush and Death Lotus");
  });

  it("strips {{g|number}} gold templates", () => {
    expect(stripWikiMarkup("gain {{g|250}}")).toBe("gain 250 gold");
    expect(stripWikiMarkup("generates {{g|25}} from kills")).toBe(
      "generates 25 gold from kills"
    );
  });

  it("strips {{nie|name}} named item effect templates", () => {
    expect(stripWikiMarkup("empowering {{nie|Death}} to execute")).toBe(
      "empowering Death to execute"
    );
    expect(stripWikiMarkup("imposed by {{nie|Immolate}}")).toBe(
      "imposed by Immolate"
    );
  });

  it("strips {{si|spell}} summoner spell/item templates", () => {
    expect(stripWikiMarkup("Using {{si|Flash}} creates")).toBe(
      "Using Flash creates"
    );
    expect(stripWikiMarkup("enemies marked by {{si|Mark}}")).toBe(
      "enemies marked by Mark"
    );
  });

  it("strips {{bi|buff}} buff name templates", () => {
    expect(stripWikiMarkup("Grants the {{bi|Crest of Cinders}} buff")).toBe(
      "Grants the Crest of Cinders buff"
    );
    expect(stripWikiMarkup("{{bi|Infernal Dragon Soul}}")).toBe(
      "Infernal Dragon Soul"
    );
  });

  it("strips {{rd|val1|val2}} ranged/reduced templates keeping first value", () => {
    expect(stripWikiMarkup("Gain {{rd|75|50}} bonus attack range")).toBe(
      "Gain 75 bonus attack range"
    );
  });

  it("strips {{ap|expression}} arithmetic templates", () => {
    expect(stripWikiMarkup("{{as|(+ {{ap|35*4}}% bonus AD)}}")).toBe(
      "(+ 35*4% bonus AD)"
    );
  });

  // --- Nested templates ---

  it("handles nested {{fd}} inside {{as}}", () => {
    expect(
      stripWikiMarkup("{{as|{{fd|0.6}} '''bonus''' attack damage|ad}}")
    ).toBe("0.6 bonus attack damage");
  });

  it("handles nested {{fd}} inside {{as}} for percentage", () => {
    expect(
      stripWikiMarkup(
        "equal to {{as|{{fd|3.5}}% of your '''maximum''' health}}"
      )
    ).toBe("equal to 3.5% of your maximum health");
  });

  it("handles deeply nested templates (ft with as and pp inside)", () => {
    const input =
      "{{ft|{{as|{{pp|key=%|0.5;1;3;9|1;4;6;11}} '''maximum''' health}} every 5 seconds.|{{as|{{pp|key=%|0.5/10;1/10;3/10;9/10|1;4;6;11}} '''maximum''' health}} every {{fd|0.5}} seconds.}}";
    const result = stripWikiMarkup(input);
    // ft should keep first param (the simple version)
    expect(result).toBe("0.5;1;3;9 maximum health every 5 seconds.");
  });

  it("handles {{sbc}} with nested {{ii}} (quest reward line)", () => {
    const input =
      "{{sbc|Reward:}} Upon completing your {{sbc|Quest}}, you receive {{ii|The Golden Spatula}}.";
    expect(stripWikiMarkup(input)).toBe(
      "Reward: Upon completing your Quest, you receive The Golden Spatula."
    );
  });

  it("handles complex augment: Upgrade Collector description", () => {
    const input =
      "Upgrades {{ii|The Collector}}, empowering {{nie|Death}} to have its execution threshold increased by {{fd|0.5}}% each time you kill an enemy champion, capped at a threshold of {{as|12.5% of the target's '''maximum''' health}}, and {{nie|Taxes}} to generate a further {{g|25}} (total {{g|50}}) from kills. Additionally, gain {{g|250}}.";
    const expected =
      "Upgrades The Collector, empowering Death to have its execution threshold increased by 0.5% each time you kill an enemy champion, capped at a threshold of 12.5% of the target's maximum health, and Taxes to generate a further 25 gold (total 50 gold) from kills. Additionally, gain 250 gold.";
    expect(stripWikiMarkup(input)).toBe(expected);
  });

  it("handles complex augment: Erosion with {{fd}}", () => {
    const input =
      "Each instance of damage dealt to an enemy reduces their {{as|armor}} and {{as|magic resistance}} by {{fd|1.5}}% for 4 seconds, stacking up to 20 times for a total of 30% resistances reduction.";
    const expected =
      "Each instance of damage dealt to an enemy reduces their armor and magic resistance by 1.5% for 4 seconds, stacking up to 20 times for a total of 30% resistances reduction.";
    expect(stripWikiMarkup(input)).toBe(expected);
  });

  it("strips {{#invoke:...}} parser function calls", () => {
    expect(
      stripWikiMarkup(
        "{{sbc|Poltergeist:}} {{#invoke:SpellData|geteffect|Poltergeist}}"
      )
    ).toBe("Poltergeist:");
  });

  it("strips HTML list markup (ul/li)", () => {
    expect(
      stripWikiMarkup("<ul><li>First item</li><li>Second item</li></ul>")
    ).toBe("First item Second item");
  });

  it("strips HTML comments", () => {
    expect(stripWikiMarkup("some text<!--this is hidden-->more text")).toBe(
      "some textmore text"
    );
  });
});
