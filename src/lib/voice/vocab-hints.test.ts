import { describe, it, expect } from "vitest";
import {
  HARD_ITEM_WORDS,
  HARD_AUGMENT_WORDS,
  HARD_CHAMPION_NAMES,
  buildVocabHints,
  formatWhisperGlossary,
} from "./vocab-hints";

describe("HARD_ITEM_WORDS", () => {
  it("contains known hard item words", () => {
    // Fantasy proper nouns that STT consistently mangles
    expect(HARD_ITEM_WORDS).toContain("Rabadon's");
    expect(HARD_ITEM_WORDS).toContain("Zhonya's");
    expect(HARD_ITEM_WORDS).toContain("Morellonomicon");
    expect(HARD_ITEM_WORDS).toContain("Fimbulwinter");
    expect(HARD_ITEM_WORDS).toContain("Hextech");
    expect(HARD_ITEM_WORDS).toContain("Manamune");
  });

  it("excludes common English words", () => {
    // These are real English words or common enough that STT handles them
    expect(HARD_ITEM_WORDS).not.toContain("Chain");
    expect(HARD_ITEM_WORDS).not.toContain("Vest");
    expect(HARD_ITEM_WORDS).not.toContain("Sword");
    expect(HARD_ITEM_WORDS).not.toContain("Hourglass");
    expect(HARD_ITEM_WORDS).not.toContain("Deathcap");
  });

  it("has the expected count", () => {
    expect(HARD_ITEM_WORDS.length).toBe(55);
  });
});

describe("HARD_AUGMENT_WORDS", () => {
  it("contains known hard augment words", () => {
    expect(HARD_AUGMENT_WORDS).toContain("Droppybara");
    expect(HARD_AUGMENT_WORDS).toContain("Minionmancer");
    expect(HARD_AUGMENT_WORDS).toContain("Poro");
    expect(HARD_AUGMENT_WORDS).toContain("Homeguard");
    expect(HARD_AUGMENT_WORDS).toContain("Witchful");
  });

  it("deduplicates with items when combined via buildVocabHints", () => {
    // Some words appear in both item and augment lists (Thornmail, Sheen, etc.).
    // The static lists are allowed to overlap — deduplication happens in
    // buildVocabHints() which combines them into a Set.
    const hints = buildVocabHints([]);
    const uniqueCount = new Set(hints).size;
    expect(uniqueCount).toBe(hints.length);
  });

  it("excludes common English words", () => {
    expect(HARD_AUGMENT_WORDS).not.toContain("Heavy");
    expect(HARD_AUGMENT_WORDS).not.toContain("Hitter");
    expect(HARD_AUGMENT_WORDS).not.toContain("Circle");
    expect(HARD_AUGMENT_WORDS).not.toContain("Death");
  });
});

describe("HARD_CHAMPION_NAMES", () => {
  it("contains fantasy champion names", () => {
    expect(HARD_CHAMPION_NAMES.has("Aatrox")).toBe(true);
    expect(HARD_CHAMPION_NAMES.has("Vel'Koz")).toBe(true);
    expect(HARD_CHAMPION_NAMES.has("Kha'Zix")).toBe(true);
    expect(HARD_CHAMPION_NAMES.has("Heimerdinger")).toBe(true);
  });

  it("excludes common English names that STT handles", () => {
    expect(HARD_CHAMPION_NAMES.has("Annie")).toBe(false);
    expect(HARD_CHAMPION_NAMES.has("Diana")).toBe(false);
    expect(HARD_CHAMPION_NAMES.has("Graves")).toBe(false);
    expect(HARD_CHAMPION_NAMES.has("Vi")).toBe(false);
    expect(HARD_CHAMPION_NAMES.has("Brand")).toBe(false);
  });

  it("has the expected count", () => {
    expect(HARD_CHAMPION_NAMES.size).toBe(89);
  });
});

describe("buildVocabHints", () => {
  it("includes static item and augment words", () => {
    const hints = buildVocabHints([]);
    expect(hints).toContain("Rabadon's");
    expect(hints).toContain("Morellonomicon");
    expect(hints).toContain("Droppybara");
  });

  it("includes hard champion names from the match", () => {
    const hints = buildVocabHints(["Aatrox", "Vel'Koz", "Annie"]);
    expect(hints).toContain("Aatrox");
    expect(hints).toContain("Vel'Koz");
  });

  it("excludes common English champion names from the match", () => {
    // Annie is a common English name — STT doesn't need help with it
    const hints = buildVocabHints(["Annie", "Diana", "Graves"]);
    expect(hints).not.toContain("Annie");
    expect(hints).not.toContain("Diana");
    expect(hints).not.toContain("Graves");
  });

  it("deduplicates across all sources", () => {
    const hints = buildVocabHints(["Kalista"]);
    // "Kalista" could appear as champion and "Kalista's" in items —
    // each unique string should appear only once
    const uniqueCount = new Set(hints).size;
    expect(uniqueCount).toBe(hints.length);
  });

  it("returns a non-empty array even with no match champions", () => {
    const hints = buildVocabHints([]);
    // Should still have item + augment hard words
    expect(hints.length).toBeGreaterThan(0);
  });
});

describe("formatWhisperGlossary", () => {
  it("formats as a comma-separated glossary with prefix", () => {
    const result = formatWhisperGlossary(["Aatrox", "Rabadon's", "Hextech"]);
    expect(result).toBe("Glossary: Aatrox, Rabadon's, Hextech");
  });

  it("returns empty string for empty input", () => {
    const result = formatWhisperGlossary([]);
    expect(result).toBe("");
  });

  it("handles a single word", () => {
    const result = formatWhisperGlossary(["Morellonomicon"]);
    expect(result).toBe("Glossary: Morellonomicon");
  });
});
