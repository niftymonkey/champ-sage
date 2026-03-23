import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import type { CoachingContext, CoachingQuery } from "./types";

function createContext(
  overrides: Partial<CoachingContext> = {}
): CoachingContext {
  return {
    champion: {
      name: "Ahri",
      level: 10,
      abilities: "Passive: Essence Theft. Q: Orb of Deception.",
    },
    currentItems: ["Rabadon's Deathcap", "Sorcerer's Shoes"],
    currentAugments: ["Jeweled Gauntlet"],
    enemyTeam: [
      { champion: "Vayne", items: ["Blade of the Ruined King"] },
      { champion: "Sona", items: ["Ardent Censer"] },
    ],
    allyTeam: [{ champion: "Garen" }],
    gameMode: "ARAM",
    gameTime: 600,
    balanceOverrides: "Damage taken: -5%",
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("contains coaching personality", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain("coach");
  });

  it("establishes blunt decisive tone", () => {
    const prompt = buildSystemPrompt().toLowerCase();
    expect(prompt).toMatch(/blunt|decisive|direct/);
  });

  it("covers general coaching topics", () => {
    const prompt = buildSystemPrompt().toLowerCase();
    expect(prompt).toContain("champion");
    expect(prompt).toContain("items");
    expect(prompt).toContain("enemy");
  });
});

describe("buildUserPrompt", () => {
  describe("with a general question", () => {
    const generalQuery: CoachingQuery = {
      question: "What should I build next?",
    };

    it("includes champion name and level", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Ahri");
      expect(prompt).toContain("10");
    });

    it("includes the question", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("What should I build next?");
    });

    it("includes enemy team", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Vayne");
      expect(prompt).toContain("Sona");
    });

    it("includes current items", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Rabadon's Deathcap");
    });

    it("includes current augments", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Jeweled Gauntlet");
    });

    it("includes game mode", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("ARAM");
    });

    it("includes balance overrides when present", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Damage taken: -5%");
    });

    it("includes champion abilities", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Orb of Deception");
    });

    it("includes ally team", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).toContain("Garen");
    });

    it("does not include augment options section when none provided", () => {
      const prompt = buildUserPrompt(createContext(), generalQuery);
      expect(prompt).not.toContain("## Augment Options");
    });
  });

  describe("with an augment selection question", () => {
    const augmentQuery: CoachingQuery = {
      question: "Which augment should I pick?",
      augmentOptions: [
        {
          name: "Jeweled Gauntlet",
          description: "Your abilities can critically strike.",
          tier: "Gold",
          sets: ["Arcana"],
        },
        {
          name: "Blade Waltz",
          description: "Dash on kill or assist.",
          tier: "Silver",
        },
      ],
    };

    it("includes augment options with descriptions", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("Jeweled Gauntlet");
      expect(prompt).toContain("Your abilities can critically strike");
      expect(prompt).toContain("Blade Waltz");
    });

    it("includes augment tiers", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("Gold");
      expect(prompt).toContain("Silver");
    });

    it("includes set information for augments that have it", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("Arcana");
    });

    it("includes the augment options section heading", () => {
      const prompt = buildUserPrompt(createContext(), augmentQuery);
      expect(prompt).toContain("## Augment Options");
    });
  });
});
