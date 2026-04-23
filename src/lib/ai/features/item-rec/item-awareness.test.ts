import { describe, it, expect } from "vitest";
import { scoreItemAwareness } from "./item-awareness";

describe("scoreItemAwareness", () => {
  // --- Should score 1.0 (good responses) ---

  it("scores 1 when no items are owned", () => {
    expect(scoreItemAwareness("Buy Thornmail next.", [])).toBe(1);
  });

  it("scores 1 when response recommends an item the player does not own", () => {
    expect(
      scoreItemAwareness("Buy **Thornmail** next.", [
        "Mercury's Treads",
        "Titanic Hydra",
      ])
    ).toBe(1);
  });

  it("scores 1 when response discusses owned items without recommending purchase", () => {
    expect(
      scoreItemAwareness(
        "Your **Titanic Hydra** gives you enough damage. Build armor next.",
        ["Titanic Hydra"]
      )
    ).toBe(1);
  });

  it("scores 1 when response acknowledges ownership without recommending repurchase", () => {
    expect(
      scoreItemAwareness(
        "You already have **Titanic Hydra**, so focus on tank stats.",
        ["Titanic Hydra"]
      )
    ).toBe(1);
  });

  it("scores 1 for non-item questions (augment choices)", () => {
    expect(
      scoreItemAwareness(
        "Take **Outlaw's Grit**. Warwick can stack it fast with R.",
        ["Mercury's Treads", "Titanic Hydra"]
      )
    ).toBe(1);
  });

  // --- Should score 0 (bad responses) ---

  it("scores 0 when response recommends buying an item the player already owns", () => {
    expect(
      scoreItemAwareness(
        "Buy **Bami's Cinder** now. It's the best immediate spike.",
        ["Mercury's Treads", "Titanic Hydra", "Bami's Cinder"]
      )
    ).toBe(0);
  });

  it("scores 0 when response recommends building an item the player already owns", () => {
    expect(
      scoreItemAwareness(
        "Build **Titanic Hydra** next. You already have Bami's.",
        ["Mercury's Treads", "Titanic Hydra", "Bami's Cinder"]
      )
    ).toBe(0);
  });

  it("scores 0 when response recommends finishing an item the player already owns", () => {
    expect(
      scoreItemAwareness("Finish **Bami's Cinder** first.", [
        "Bami's Cinder",
        "Boots",
      ])
    ).toBe(0);
  });

  it("scores 0 from real session: recommends Bami's when player has it", () => {
    // Fixture [11] from 2026-03-26 session
    const response =
      "Buy **Bami's Cinder** now. It's the best immediate spike on Warwick " +
      "here: cheap HP, strong wavefight damage, and it keeps you on track to " +
      "finish **Titanic Hydra**.";
    const items = [
      "Mercury's Treads",
      "Titanic Hydra",
      "Elixir of Iron",
      "Bami's Cinder",
    ];
    expect(scoreItemAwareness(response, items)).toBe(0);
  });

  it("scores 0 from real session: recommends Titanic Hydra when player has it", () => {
    // Fixture [12] from 2026-03-26 session
    const response =
      "Build **Titanic Hydra** next. You already have Bami's, and Titanic is " +
      "your real damage spike with HP scaling, waveclear, and better all-in " +
      "pressure on Warwick.";
    const items = [
      "Mercury's Treads",
      "Titanic Hydra",
      "Elixir of Iron",
      "Bami's Cinder",
    ];
    expect(scoreItemAwareness(response, items)).toBe(0);
  });

  it("scores 0 even when response acknowledges then contradicts itself", () => {
    // Model says "you already have X" then recommends buying X anyway
    const response =
      "Yes — you already have **Titanic Hydra**. Build **Titanic Hydra** " +
      "to finish your core.";
    expect(scoreItemAwareness(response, ["Titanic Hydra"])).toBe(0);
  });
});
