import { describe, it, expect } from "vitest";
import { parseAbilityTemplate } from "./wiki-ability-template";

/**
 * Build a Data template page. Mirrors the real wiki shape: a template
 * invocation header followed by line-anchored `|name = value` params.
 */
function page(params: string, preamble = ""): string {
  return `${preamble}{{{{{1<noinclude>|Ability data</noinclude>}}}|Some Ability|{{{2|}}}|{{{3|}}}
${params}
|targeting    = Unit
|affects      = Enemies`;
}

describe("parseAbilityTemplate", () => {
  describe("identity", () => {
    it("reads the champion and slot the page declares", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Magic Damage|{{ap|35 to 135}}}}`)
      );
      expect(result.champion).toBe("Ahri");
      expect(result.slot).toBe("Q");
    });

    it("returns null identity when the page declares none", () => {
      const result = parseAbilityTemplate(page(`|description  = nothing here`));
      expect(result.champion).toBeNull();
      expect(result.slot).toBeNull();
    });

    it("returns null slot for a value outside Q/W/E/R", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Passive`)
      );
      expect(result.slot).toBeNull();
    });
  });

  describe("clean parses", () => {
    it("parses Ahri Q, evaluating the arithmetic in derived stats", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Damage Per Pass|{{ap|35 to 135}} {{as|(+ 50% AP)}}|Total Mixed Damage|{{ap|35*2 to 135*2}} {{as|(+ {{ap|50*2}}% AP)}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Damage Per Pass", value: "35 to 135 (+ 50% AP)" },
        { label: "Total Mixed Damage", value: "70 to 270 (+ 100% AP)" },
      ]);
      expect(result.quarantined).toEqual([]);
    });

    it("parses Nasus Q, stripping italics from the ratio text", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Nasus
|skill        = Q
|leveling     = {{st|Bonus Physical Damage|{{ap|40 to 120}} {{as|(+ 100% of ''Siphoning Strike'' stacks)|Siphoning Strike}}}}`)
      );
      expect(result.stats).toEqual([
        {
          label: "Bonus Physical Damage",
          value: "40 to 120 (+ 100% of Siphoning Strike stacks)",
        },
      ]);
    });

    it("strips bold markers from ratio text", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Akshan
|skill        = Q
|leveling     = {{st|Physical Damage|{{ap|45 to 165}} {{as|(+ 70% '''bonus''' AD)}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Physical Damage", value: "45 to 165 (+ 70% bonus AD)" },
      ]);
    });

    it("keeps every stat table when one leveling param holds several", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = E
|leveling     = {{st|Magic Damage|{{ap|80 to 240}} {{as|(+ 85% AP)}}}} {{st|Charm Duration|{{ap|1 to 2}} seconds}}`)
      );
      expect(result.stats).toEqual([
        { label: "Magic Damage", value: "80 to 240 (+ 85% AP)" },
        { label: "Charm Duration", value: "1 to 2 seconds" },
      ]);
    });

    it("collects numbered leveling params in order", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = W
|description  = first
|leveling2    = {{st|Primary Magic Damage|{{ap|40 to 120}} {{as|(+ 40% AP)}}}}
|description3 = third
|leveling4    = {{st|Primary Minion Damage|{{ap|40*2 to 120*2}} {{as|(+ {{ap|40*2}}% AP)}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Primary Magic Damage", value: "40 to 120 (+ 40% AP)" },
        { label: "Primary Minion Damage", value: "80 to 240 (+ 80% AP)" },
      ]);
    });

    it("orders leveling10 after leveling2 rather than lexically", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Aphelios
|skill        = Q
|leveling10   = {{st|Tenth|{{ap|10 to 20}}}}
|leveling2    = {{st|Second|{{ap|1 to 2}}}}`)
      );
      expect(result.stats.map((s) => s.label)).toEqual(["Second", "Tenth"]);
    });

    it("resolves page variables defined by {{#vardefine}}", () => {
      const result = parseAbilityTemplate(
        page(
          `|champion     = Aatrox
|skill        = Q
|leveling3    = {{st|First Cast Damage|{{ap|{{#var:b1}} to {{#var:b2}}}} {{as|(+ {{ap|{{#var:r1}} to {{#var:r2}}}}% AD)}}}}`,
          `{{#vardefine:b1|10}}{{#vardefine:b2|70}}{{#vardefine:r1|60}}{{#vardefine:r2|90}}`
        )
      );
      expect(result.stats).toEqual([
        { label: "First Cast Damage", value: "10 to 70 (+ 60 to 90% AD)" },
      ]);
    });

    it("parses a stat table broken up by HTML comments", () => {
      // Aatrox uses comments to wrap long leveling params across lines, which
      // puts one between "{{st" and its first pipe.
      const result = parseAbilityTemplate(
        page(`|champion     = Aatrox
|skill        = Q
|leveling6    = {{st<!--
-->|Maximum Damage|<!--
-->{{ap|30 to 210}} {{as|(+ 180% AD)}}<!--
-->}}`)
      );
      expect(result.stats).toEqual([
        { label: "Maximum Damage", value: "30 to 210 (+ 180% AD)" },
      ]);
    });

    it("renders an {{ap}} rank series as slash-separated ranks", () => {
      // Ultimates list ranks explicitly rather than as a range. Pipes would
      // otherwise be flattened to spaces, rendering "200 350 500" with no
      // separator semantics at all.
      const result = parseAbilityTemplate(
        page(`|champion     = Yasuo
|skill        = R
|leveling2    = {{st|Physical Damage|{{ap|200|350|500}} {{as|(+ 150% '''bonus''' AD)}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Physical Damage", value: "200/350/500 (+ 150% bonus AD)" },
      ]);
    });

    it("evaluates arithmetic in each rank of an {{ap}} rank series", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Akshan
|skill        = R
|leveling     = {{st|Minimum Charged Physical Damage|{{ap|5*25|6*35|7*45}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Minimum Charged Physical Damage", value: "125/210/315" },
      ]);
    });

    it("ignores named {{ap}} options such as round=", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Akshan
|skill        = R
|leveling     = {{st|Bullet Storing Interval Time|{{ap|2.5/4 to 2.5/6|round=4}} seconds}}`)
      );
      expect(result.stats).toEqual([
        {
          label: "Bullet Storing Interval Time",
          value: "0.63 to 0.42 seconds",
        },
      ]);
    });

    it("resolves page variables that are defined in terms of other variables", () => {
      // Fiddlesticks defines total_ticks as an expression over two other vars,
      // so a single substitution pass leaves {{#var:}} refs behind.
      const result = parseAbilityTemplate(
        page(
          `|champion     = Fiddlesticks
|skill        = W
|leveling2    = {{st|Damage per Instance|{{ap|{{#var:total_damage}}/{{#var:total_ticks}}}}}}`,
          `{{#vardefine:channel_duration|2.5}}{{#vardefine:channel_tickrate|0.25}}{{#vardefine:total_ticks|{{#expr:{{#var:channel_duration}}/{{#var:channel_tickrate}}}}}}{{#vardefine:total_damage|200}}`
        )
      );
      expect(result.stats).toEqual([
        { label: "Damage per Instance", value: "20" },
      ]);
    });

    it("keeps trailing prose around a resolved range", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = E
|leveling     = {{st|Disable Duration|{{ap|1.2 to 1.8}} seconds}}`)
      );
      expect(result.stats).toEqual([
        { label: "Disable Duration", value: "1.2 to 1.8 seconds" },
      ]);
    });

    it("keeps a percentage-of-stat value, parentheses and all", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Nasus
|skill        = E
|leveling     = {{st|Armor Reduction|{{ap|30 to 50}}% of target's armor}}`)
      );
      expect(result.stats).toEqual([
        { label: "Armor Reduction", value: "30 to 50% of target's armor" },
      ]);
    });

    it("resolves a {{tt}} tooltip used as a stat label", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Anivia
|skill        = W
|leveling     = {{st|{{tt|Width|Pathfinding}}|{{ap|600 to 1000}} units}}`)
      );
      expect(result.stats).toEqual([
        { label: "Width", value: "600 to 1000 units" },
      ]);
    });

    it("evaluates {{#expr:}} arithmetic", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Aatrox
|skill        = Q
|leveling     = {{st|Bonus Damage|{{#expr:(1.75-1)*100}}% at {{ap|10 to 20}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Bonus Damage", value: "75% at 10 to 20" },
      ]);
    });

    it("returns no stats when the page has no leveling params", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = W
|description  = Ahri gains movement speed.`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([]);
    });
  });

  describe("wikitext comments", () => {
    it("ignores a commented-out leveling param", () => {
      // The param regex is line-anchored, so a commented-out param still
      // starts a line with a pipe and would otherwise be read as live data.
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
<!--
|leveling     = {{st|Old Damage|{{ap|1 to 2}}}}
-->
|leveling2    = {{st|Magic Damage|{{ap|35 to 135}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Magic Damage", value: "35 to 135" },
      ]);
    });

    it("ignores a commented-out vardefine rather than letting it win", () => {
      const result = parseAbilityTemplate(
        page(
          `|champion     = Aatrox
|skill        = Q
|leveling     = {{st|Damage|{{ap|{{#var:b1}} to 70}}}}`,
          `<!--{{#vardefine:b1|999}}-->{{#vardefine:b1|10}}`
        )
      );
      expect(result.stats).toEqual([{ label: "Damage", value: "10 to 70" }]);
    });

    it("quarantines a stat whose only vardefine was commented out", () => {
      const result = parseAbilityTemplate(
        page(
          `|champion     = Aatrox
|skill        = Q
|leveling     = {{st|Damage|{{ap|{{#var:b1}} to 70}}}}`,
          `<!--{{#vardefine:b1|10}}-->`
        )
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        {
          label: "Damage",
          reason: { kind: "unresolved-variable", variable: "b1" },
        },
      ]);
    });

    it("keeps uncommented content that neighbours a comment", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Magic Damage|{{ap|35 to 135}}<!-- do not touch --> {{as|(+ 50% AP)}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Magic Damage", value: "35 to 135 (+ 50% AP)" },
      ]);
    });
  });

  describe("quarantine", () => {
    it("drops a stat built from an unrecognized template", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Yasuo
|skill        = Q
|leveling     = {{st|Critical Strike Damage|{{ap|20 to 120}} {{as|{{ccd|Yasuo|crit_base}} AD}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        {
          label: "Critical Strike Damage",
          reason: { kind: "unknown-template", template: "ccd" },
        },
      ]);
    });

    it("keeps the clean stats of an ability whose other stats quarantine", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Yasuo
|skill        = Q
|leveling     = {{st|Physical Damage|{{ap|20 to 120}} {{as|(+ 105% AD)}}|Critical Strike Damage|{{as|{{ccd|Yasuo|crit_base}} AD}}}}`)
      );
      expect(result.stats).toEqual([
        { label: "Physical Damage", value: "20 to 120 (+ 105% AD)" },
      ]);
      expect(result.quarantined).toHaveLength(1);
    });

    it("drops a stat referencing a variable the page never defined", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Locke
|skill        = Q
|leveling     = {{st|Magic Damage per Nail|{{ap|{{#var:b1}} to {{#var:b2}}}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        {
          label: "Magic Damage per Nail",
          reason: { kind: "unresolved-variable", variable: "b1" },
        },
      ]);
    });

    it("drops a stat whose arithmetic is malformed", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Aurelion Sol
|skill        = Q
|leveling     = {{st|Total Maximum Magic Damage|{{ap|(45/8)*26 to ((45+(105-45)*(3/4))/8)*26 4}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        {
          label: "Total Maximum Magic Damage",
          reason: {
            kind: "arithmetic-failed",
            expression: "(45/8)*26 to ((45+(105-45)*(3/4))/8)*26 4",
          },
        },
      ]);
    });

    it("drops a stat built from a parser function such as #invoke", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Viego
|skill        = Q
|leveling     = {{st|Damage|{{#invoke:ItemData|get|Blade|damage}} plus {{ap|10 to 20}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        {
          label: "Damage",
          reason: { kind: "unknown-template", template: "#invoke" },
        },
      ]);
    });

    it("drops a stat whose {{ap}} arithmetic is left dangling", () => {
      // The residual-markup gate checks for {}[]|*=# but not + - ( ), so a
      // failed evaluation must be refused here or "40 +" reaches the prompt.
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Magic Damage|{{ap|40 +}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toHaveLength(1);
    });

    it("drops a stat whose {{ap}} parenthesis is unbalanced", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Magic Damage|{{ap|(40}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toHaveLength(1);
    });

    it("quarantines a pathologically nested expression without taking the page down", () => {
      // A stack overflow here would escape parseAbilityTemplate entirely and
      // cost every champion their scaling for the session, not just this stat.
      const pathological = "(".repeat(50_000) + "5" + ")".repeat(50_000);
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Magic Damage|{{ap|35 to 135}} {{as|(+ 50% AP)}}}} {{st|Broken|{{ap|${pathological}}}}}`)
      );

      // The clean stat on the same ability must still survive.
      expect(result.stats).toEqual([
        { label: "Magic Damage", value: "35 to 135 (+ 50% AP)" },
      ]);
      expect(result.quarantined).toHaveLength(1);
      expect(result.quarantined[0].reason.kind).toBe("arithmetic-failed");
    });

    it("drops a stat whose value carries no number", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Damage Type|{{as|magic}}}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        { label: "Damage Type", reason: { kind: "no-numeric-value" } },
      ]);
    });

    it("drops a leveling param that is not a stat table", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = 35 to 135 magic damage`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toEqual([
        { label: "", reason: { kind: "malformed-leveling" } },
      ]);
    });

    it("drops a stat that still holds markup after resolution", () => {
      const result = parseAbilityTemplate(
        page(`|champion     = Ahri
|skill        = Q
|leveling     = {{st|Magic Damage|{{ap|35 to 135}} [[Ability power}}`)
      );
      expect(result.stats).toEqual([]);
      expect(result.quarantined).toHaveLength(1);
      expect(result.quarantined[0].reason.kind).toBe("residual-markup");
    });
  });
});
