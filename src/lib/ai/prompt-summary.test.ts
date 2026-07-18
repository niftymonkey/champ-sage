import { describe, it, expect } from "vitest";
import { summarizeBaseContext } from "./prompt-summary";

/**
 * A trimmed but structurally faithful slice of a real base context: the
 * section headers and line shapes the summary scans for are exactly as
 * `buildBaseContext` emits them.
 */
const REAL_SHAPED_CONTEXT = [
  "You are an expert League of Legends coaching AI.",
  "",
  "GAME MODE: ARAM Mayhem",
  "",
  "## Player Champion",
  "Ahri — the Nine-Tailed Fox",
  "",
  "### Abilities",
  "Passive: Essence Theft — heals.",
  "Q - Orb of Deception: throws an orb. [CD 7s | cost 55 | range 970 | Damage Per Pass: 35 to 135 (+ 50% AP)]",
  "E - Charm: a kiss. [CD 12s | cost 60 | range 975 | Magic Damage: 80 to 240 (+ 85% AP)]",
  "",
  "## Item pool for Ahri (patch 16.13)",
  "**Luden's Echo** — 100 AP. Cost: 2750g",
  "",
  "## Other available items",
  "- Abyssal Mask — 350 HP, 50 MR. 2850g",
  "- Rabadon's Deathcap — 130 AP. 3500g",
  "- Void Staff — 95 AP. 3000g",
  "",
  "## Match Roster",
  "Ally Team: Ahri (Mage/Assassin)",
].join("\n");

describe("summarizeBaseContext", () => {
  it("detects the abilities section", () => {
    expect(summarizeBaseContext(REAL_SHAPED_CONTEXT).hasAbilities).toBe(true);
  });

  it("counts scaling-ratio markers so a scaling regression shows as zero", () => {
    // Two "(+ ... AP)" ratios above. A drop to 0 is the regression signal.
    expect(summarizeBaseContext(REAL_SHAPED_CONTEXT).scalingRatios).toBe(2);
  });

  it("counts the tier-2 reference item lines", () => {
    // Three "- Item ..." lines under Other available items; the "**Item**"
    // tier-1 line and the "Q - "/"E - " ability lines must NOT be counted.
    expect(summarizeBaseContext(REAL_SHAPED_CONTEXT).catalogItems).toBe(3);
  });

  it("reports absence rather than throwing on a champion-less context", () => {
    const summary = summarizeBaseContext("GAME MODE: ARAM\n\n## Match Roster");
    expect(summary.hasAbilities).toBe(false);
    expect(summary.scalingRatios).toBe(0);
    expect(summary.catalogItems).toBe(0);
  });

  it("renders a compact one-line form for the log", () => {
    expect(summarizeBaseContext(REAL_SHAPED_CONTEXT).line).toBe(
      "abilities=yes scalingRatios=2 catalogItems=3"
    );
  });
});
