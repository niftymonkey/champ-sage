import { describe, it, expect } from "vitest";
import { scoreStateAwareness } from "./state-awareness";

describe("scoreStateAwareness", () => {
  it("returns 1 when no hints provided (N/A fixture)", () => {
    expect(scoreStateAwareness("Buy Rabadon's Deathcap.", undefined, [])).toBe(
      1
    );
  });

  it("returns 1 when hints array is empty", () => {
    expect(scoreStateAwareness("Buy Rabadon's Deathcap.", [], [])).toBe(1);
  });

  // --- grievous-wounds rule ---

  it("returns 0 when grievous-wounds hint present but response has no GW keywords", () => {
    expect(
      scoreStateAwareness(
        "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now.",
        ["grievous-wounds"],
        []
      )
    ).toBe(0);
  });

  it("returns 1 when grievous-wounds hint present and response mentions anti-heal", () => {
    expect(
      scoreStateAwareness(
        "You need anti-heal against Soraka. Build toward Morellonomicon.",
        ["grievous-wounds"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when grievous-wounds hint present and response mentions grievous wounds", () => {
    expect(
      scoreStateAwareness(
        "Pick up grievous wounds to cut their healing.",
        ["grievous-wounds"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when grievous-wounds hint present and response mentions Thornmail", () => {
    expect(
      scoreStateAwareness(
        "Build toward Thornmail for the anti-heal passive.",
        ["grievous-wounds"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when grievous-wounds hint present and response mentions Oblivion Orb", () => {
    expect(
      scoreStateAwareness(
        "You can get an Oblivion Orb now to reduce their healing.",
        ["grievous-wounds"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when grievous-wounds hint present and response mentions Chempunk", () => {
    expect(
      scoreStateAwareness(
        "Build toward Chempunk Chainsword.",
        ["grievous-wounds"],
        []
      )
    ).toBe(1);
  });

  // --- mr-needed rule ---

  it("returns 0 when mr-needed hint present but response has no MR keywords", () => {
    expect(
      scoreStateAwareness(
        "Build toward Infinity Edge for more damage.",
        ["mr-needed"],
        []
      )
    ).toBe(0);
  });

  it("returns 1 when mr-needed hint present and response mentions magic resist", () => {
    expect(
      scoreStateAwareness(
        "You need magic resist against their AP-heavy comp.",
        ["mr-needed"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when mr-needed hint present and response mentions MR", () => {
    expect(
      scoreStateAwareness(
        "Get some MR — they have 3 AP threats.",
        ["mr-needed"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when mr-needed hint present and response mentions Spirit Visage", () => {
    expect(
      scoreStateAwareness(
        "Build toward Spirit Visage for sustain and MR.",
        ["mr-needed"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when mr-needed hint present and response mentions Force of Nature", () => {
    expect(
      scoreStateAwareness(
        "Force of Nature is your best option here.",
        ["mr-needed"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when mr-needed hint present and response mentions Banshee's Veil", () => {
    expect(
      scoreStateAwareness(
        "Consider Banshee's Veil for the spell shield.",
        ["mr-needed"],
        []
      )
    ).toBe(1);
  });

  it("returns 1 when mr-needed hint present and response mentions Abyssal Mask", () => {
    expect(
      scoreStateAwareness(
        "Abyssal Mask will help your team deal more magic damage.",
        ["mr-needed"],
        []
      )
    ).toBe(1);
  });

  // --- enemy-comp rule ---

  it("returns 0 when enemy-comp hint present but response is generic", () => {
    expect(
      scoreStateAwareness(
        "Build toward Infinity Edge. You can get a B.F. Sword now.",
        ["enemy-comp"],
        [],
        ["Syndra", "Vex", "Brand"]
      )
    ).toBe(0);
  });

  it("returns 1 when enemy-comp hint present and response mentions an enemy champion", () => {
    expect(
      scoreStateAwareness(
        "Against Syndra, you want magic resist.",
        ["enemy-comp"],
        [],
        ["Syndra", "Vex", "Brand"]
      )
    ).toBe(1);
  });

  it("returns 1 when enemy-comp hint present and response mentions damage profile", () => {
    expect(
      scoreStateAwareness(
        "Their team is mostly AP damage, so prioritize MR.",
        ["enemy-comp"],
        [],
        ["Syndra", "Vex", "Brand"]
      )
    ).toBe(1);
  });

  // --- existing-items rule ---

  it("returns 0 when existing-items hint present but response ignores owned items", () => {
    expect(
      scoreStateAwareness(
        "Build toward Rabadon's Deathcap.",
        ["existing-items"],
        ["Mercury's Treads", "Titanic Hydra"]
      )
    ).toBe(0);
  });

  it("returns 1 when existing-items hint present and response references an owned item", () => {
    expect(
      scoreStateAwareness(
        "Since you already have Titanic Hydra, build toward Sunfire Aegis.",
        ["existing-items"],
        ["Mercury's Treads", "Titanic Hydra"]
      )
    ).toBe(1);
  });

  // --- multiple rules ---

  it("returns 0 when one rule passes but another fails", () => {
    expect(
      scoreStateAwareness(
        "You need anti-heal to cut their healing. Build Morellonomicon.",
        ["grievous-wounds", "mr-needed"],
        []
      )
    ).toBe(0);
  });

  it("returns 1 when all rules pass", () => {
    expect(
      scoreStateAwareness(
        "You need anti-heal against their healing and MR against their AP. Build Morellonomicon for grievous wounds.",
        ["grievous-wounds", "mr-needed"],
        []
      )
    ).toBe(1);
  });
});
