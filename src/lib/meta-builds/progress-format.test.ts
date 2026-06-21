import { describe, it, expect } from "vitest";
import {
  fmtN,
  progressBar,
  pctLabel,
  snowballProgressLines,
  barProgressLines,
} from "./progress-format";

describe("fmtN", () => {
  it("adds thousands separators", () => {
    expect(fmtN(7234)).toBe("7,234");
    expect(fmtN(15000)).toBe("15,000");
    expect(fmtN(0)).toBe("0");
  });

  it("rounds fractional counts", () => {
    expect(fmtN(1234.6)).toBe("1,235");
  });
});

describe("progressBar", () => {
  it("fills proportionally at the given width", () => {
    expect(progressBar(0.5, 16)).toBe("▕████████░░░░░░░░▏");
    expect(progressBar(0, 16)).toBe("▕░░░░░░░░░░░░░░░░▏");
    expect(progressBar(1, 16)).toBe("▕████████████████▏");
  });

  it("clamps out-of-range fractions instead of overflowing", () => {
    expect(progressBar(1.5, 8)).toBe("▕████████▏");
    expect(progressBar(-0.5, 8)).toBe("▕░░░░░░░░▏");
  });
});

describe("pctLabel", () => {
  it("right-aligns to a stable 4-char width and floors", () => {
    expect(pctLabel(0.48)).toBe(" 48%");
    expect(pctLabel(0.4839)).toBe(" 48%");
    expect(pctLabel(1)).toBe("100%");
    expect(pctLabel(0.05)).toBe("  5%");
  });

  it("clamps over 100%", () => {
    expect(pctLabel(2)).toBe("100%");
  });
});

describe("snowballProgressLines", () => {
  it("shows collected fresh-in-window matches with a context line below", () => {
    const lines = snowballProgressLines({
      inWindowCount: 7234,
      totalMatches: 56012,
      playersChecked: 1240,
      queueSize: 3180,
      recentMatchesPerQuery: 0.8,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("  collecting · 7,234 fresh matches in window");
    expect(lines[1]).toBe(
      "   56,012 total · 1,240 players checked · ~3,180 pending · 0.8 new/query"
    );
  });

  it("shows no target denominator and no percent-to-target bar", () => {
    const lines = snowballProgressLines({
      inWindowCount: 7234,
      totalMatches: 56012,
      playersChecked: 1240,
      queueSize: 3180,
      recentMatchesPerQuery: 0.8,
    });
    const joined = lines.join("\n");
    // No "/ 15,000"-style denominator and no percent-to-target bar glyphs.
    expect(joined).not.toContain("/ 15,000");
    expect(joined).not.toContain("█");
    expect(joined).not.toContain("░");
    expect(joined).not.toMatch(/\d+%/);
  });

  it("reports the full pending count across both queue tiers", () => {
    const lines = snowballProgressLines({
      inWindowCount: 100,
      totalMatches: 200,
      playersChecked: 50,
      queueSize: 900,
      recentMatchesPerQuery: 0.2,
    });
    expect(lines[1]).toContain("~900 pending");
  });
});

describe("barProgressLines", () => {
  it("renders a known-total bar with a subtitle", () => {
    const lines = barProgressLines({
      done: 500,
      total: 2000,
      label: "match details fetched",
      subtitle: "1,500 total cached · 500 in-window",
    });
    expect(lines[0]).toBe(
      "   25% ▕████░░░░░░░░░░░░▏  500 / 2,000 match details fetched"
    );
    expect(lines[1]).toBe("   1,500 total cached · 500 in-window");
  });

  it("renders an empty bar at zero total instead of NaN", () => {
    const lines = barProgressLines({
      done: 0,
      total: 0,
      label: "players listed",
      subtitle: "no work",
    });
    expect(lines[0]).toBe("    0% ▕░░░░░░░░░░░░░░░░▏  0 / 0 players listed");
  });
});
