import { describe, it, expect } from "vitest";
import { addSelectedAugment, computeSetProgress } from "./augment-selection";
import type { Augment, AugmentSet } from "../data-ingest/types";
import type { ModeContext, PlayerModeContext, GameMode } from "./types";

const stubMode: GameMode = {
  id: "test",
  displayName: "Test",
  decisionTypes: [],
  matches: () => true,
  buildContext: () => ({}) as ModeContext,
};

function createAugment(name: string, sets: string[] = []): Augment {
  return {
    name,
    description: `${name} description`,
    tier: "Silver",
    sets,
    mode: "mayhem",
  };
}

function createModeContext(selectedAugments: Augment[] = []): ModeContext {
  const playerCtx: PlayerModeContext = {
    championName: "Ahri",
    team: "ORDER",
    tags: ["Mage"],
    balanceOverrides: null,
    selectedAugments,
    setProgress: [],
  };

  return {
    mode: stubMode,
    playerContexts: new Map([["Player1", playerCtx]]),
    modeItems: new Map(),
    modeAugments: new Map(),
    augmentSets: [
      {
        name: "Firecracker",
        bonuses: [
          { threshold: 2, description: "Bounce to 2 enemies" },
          { threshold: 4, description: "Bounce to 3 enemies" },
        ],
      },
      {
        name: "Archmage",
        bonuses: [{ threshold: 2, description: "30% cooldown refund" }],
      },
    ],
    allyTeamComp: { players: [playerCtx], classCounts: {} },
    enemyTeamComp: { players: [], classCounts: {} },
  };
}

describe("addSelectedAugment", () => {
  it("adds an augment to the player's selected augments", () => {
    const ctx = createModeContext();
    const augment = createAugment("Typhoon", ["Firecracker"]);

    const updated = addSelectedAugment(ctx, "Player1", augment);
    const player = updated.playerContexts.get("Player1")!;

    expect(player.selectedAugments).toHaveLength(1);
    expect(player.selectedAugments[0].name).toBe("Typhoon");
  });

  it("accumulates multiple augments", () => {
    const ctx = createModeContext([createAugment("Typhoon", ["Firecracker"])]);
    const augment = createAugment("Magic Missile", ["Firecracker"]);

    const updated = addSelectedAugment(ctx, "Player1", augment);
    const player = updated.playerContexts.get("Player1")!;

    expect(player.selectedAugments).toHaveLength(2);
  });

  it("returns a new ModeContext (immutable)", () => {
    const ctx = createModeContext();
    const augment = createAugment("Typhoon");

    const updated = addSelectedAugment(ctx, "Player1", augment);

    expect(updated).not.toBe(ctx);
    expect(updated.playerContexts).not.toBe(ctx.playerContexts);
    // Original unchanged
    expect(ctx.playerContexts.get("Player1")!.selectedAugments).toHaveLength(0);
  });

  it("recomputes set progress after adding an augment", () => {
    const ctx = createModeContext([createAugment("Typhoon", ["Firecracker"])]);
    const augment = createAugment("Magic Missile", ["Firecracker"]);

    const updated = addSelectedAugment(ctx, "Player1", augment);
    const player = updated.playerContexts.get("Player1")!;

    expect(player.setProgress).toHaveLength(1);
    expect(player.setProgress[0].set.name).toBe("Firecracker");
    expect(player.setProgress[0].count).toBe(2);
  });

  it("does nothing if player key not found", () => {
    const ctx = createModeContext();
    const augment = createAugment("Typhoon");

    const updated = addSelectedAugment(ctx, "NonExistent", augment);
    expect(updated).toBe(ctx);
  });
});

describe("computeSetProgress", () => {
  const sets: AugmentSet[] = [
    {
      name: "Firecracker",
      bonuses: [
        { threshold: 2, description: "Bounce to 2 enemies" },
        { threshold: 4, description: "Bounce to 3 enemies" },
      ],
    },
    {
      name: "Archmage",
      bonuses: [{ threshold: 2, description: "30% cooldown refund" }],
    },
  ];

  it("returns empty array when no augments have sets", () => {
    const augments = [createAugment("Scoped Weapons")];
    expect(computeSetProgress(augments, sets)).toEqual([]);
  });

  it("tracks progress for a single set", () => {
    const augments = [createAugment("Typhoon", ["Firecracker"])];
    const progress = computeSetProgress(augments, sets);

    expect(progress).toHaveLength(1);
    expect(progress[0].set.name).toBe("Firecracker");
    expect(progress[0].count).toBe(1);
    expect(progress[0].nextBonus).toEqual({
      threshold: 2,
      description: "Bounce to 2 enemies",
    });
  });

  it("updates next bonus when threshold is reached", () => {
    const augments = [
      createAugment("Typhoon", ["Firecracker"]),
      createAugment("Magic Missile", ["Firecracker"]),
    ];
    const progress = computeSetProgress(augments, sets);

    expect(progress[0].count).toBe(2);
    expect(progress[0].nextBonus).toEqual({
      threshold: 4,
      description: "Bounce to 3 enemies",
    });
  });

  it("sets nextBonus to null when all thresholds reached", () => {
    const augments = [
      createAugment("A", ["Archmage"]),
      createAugment("B", ["Archmage"]),
    ];
    const progress = computeSetProgress(augments, sets);

    expect(progress[0].count).toBe(2);
    expect(progress[0].nextBonus).toBeNull();
  });

  it("tracks multiple sets independently", () => {
    const augments = [
      createAugment("Typhoon", ["Firecracker"]),
      createAugment("Buff Buddies", ["Archmage"]),
    ];
    const progress = computeSetProgress(augments, sets);

    expect(progress).toHaveLength(2);
    const names = progress.map((p) => p.set.name).sort();
    expect(names).toEqual(["Archmage", "Firecracker"]);
  });

  it("handles augments belonging to multiple sets", () => {
    const augments = [
      createAugment("Self Destruct", ["Dive Bomb", "Fully Automated"]),
    ];
    const setsWithBoth: AugmentSet[] = [
      { name: "Dive Bomb", bonuses: [{ threshold: 2, description: "test" }] },
      {
        name: "Fully Automated",
        bonuses: [{ threshold: 2, description: "test" }],
      },
    ];
    const progress = computeSetProgress(augments, setsWithBoth);

    expect(progress).toHaveLength(2);
  });
});
