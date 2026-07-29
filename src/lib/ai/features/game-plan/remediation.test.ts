import { describe, it, expect } from "vitest";
import { buildCorrectiveMessage, remediateGamePlan } from "./remediation";
import type { BuildPathDrop, GamePlanInput } from "./index";
import type { GamePlanResult } from "./schema";
import type { BuildPathItem } from "../../types";
import type { Item, ItemMode } from "../../../data-ingest/types";
import type { GameMode, ModeContext } from "../../../mode/types";
import { GAME_MODE_CLASSIC } from "../../../mode/types";
import type { AskResult, CoachingFeature, MatchPhase } from "../../feature";
import type { MatchSession } from "../../match-session";

function createStubMode(modeId: string): GameMode {
  return {
    id: modeId,
    displayName: modeId,
    decisionTypes: ["item-purchase"],
    augmentSelectionLevels: [],
    matches: (m: string) => m === modeId,
    buildContext: () => ({}) as ModeContext,
  };
}

const classic = createStubMode(GAME_MODE_CLASSIC);

interface MakeItemOptions {
  mutexGroups?: string[];
  mode?: ItemMode;
  maps?: number[];
  tags?: string[];
}

function makeItem(
  id: number,
  name: string,
  options: MakeItemOptions = {}
): [number, Item] {
  return [
    id,
    {
      id,
      name,
      description: "",
      plaintext: "",
      gold: { base: 0, total: 3000, sell: 2100, purchasable: true },
      tags: options.tags ?? [],
      stats: {},
      image: `${id}.png`,
      mode: options.mode ?? "standard",
      maps: options.maps ?? [11, 12],
      mutexGroups: options.mutexGroups,
    },
  ];
}

const items = new Map<number, Item>([
  makeItem(3036, "Lord Dominik's Regards", { mutexGroups: ["Fatality"] }),
  makeItem(3033, "Mortal Reminder", { mutexGroups: ["Fatality"] }),
  makeItem(3009, "Boots of Swiftness", { tags: ["Boots"] }),
  makeItem(3111, "Mercury's Treads", { tags: ["Boots"] }),
  makeItem(3031, "Infinity Edge"),
  makeItem(3072, "Bloodthirster"),
  makeItem(3508, "Essence Reaver"),
  makeItem(6675, "Navori Flickerblade"),
  makeItem(4015, "Perplexity", { maps: [30] }),
]);

function entry(
  name: string,
  category: BuildPathItem["category"] = "core"
): BuildPathItem {
  return { name, category, targetEnemy: null, reason: "" };
}

function plan(answer: string, names: string[]): GamePlanResult {
  return { answer, buildPath: names.map((n) => entry(n)) };
}

const LEGAL_NAMES = [
  "Boots of Swiftness",
  "Infinity Edge",
  "Bloodthirster",
  "Essence Reaver",
  "Navori Flickerblade",
  "Lord Dominik's Regards",
];

const gamePlanFeature: CoachingFeature<GamePlanInput, GamePlanResult> = {
  id: "game-plan",
  supportedPhases: ["in-game"] as const,
  buildTaskPrompt: () => "",
  buildUserMessage: () => "",
  outputSchema: {} as CoachingFeature<
    GamePlanInput,
    GamePlanResult
  >["outputSchema"],
  extractResult: (raw) => raw,
  summarizeForHistory: (result) => result.answer,
};

interface FakeSessionState {
  session: MatchSession;
  corrections: string[];
  correctedFeatures: Array<CoachingFeature<unknown, unknown>>;
  correctedInputs: unknown[];
}

/**
 * Fake MatchSession whose correctLastAsk records its arguments and either
 * resolves with the configured response or throws the configured error.
 */
function createFakeSession(config: {
  correctedResponse?: GamePlanResult;
  correctiveError?: Error;
}): FakeSessionState {
  const corrections: string[] = [];
  const correctedFeatures: Array<CoachingFeature<unknown, unknown>> = [];
  const correctedInputs: unknown[] = [];

  const session: MatchSession = {
    systemPrompt: "",
    messages: [],
    phase: "in-game" as MatchPhase,
    async ask() {
      throw new Error("ask must not be called during remediation");
    },
    transitionTo() {},
    async correctLastAsk<TInput, TOutput>(
      feature: CoachingFeature<TInput, TOutput>,
      input: TInput,
      correction: string
    ): Promise<AskResult<TOutput>> {
      corrections.push(correction);
      correctedFeatures.push(feature as CoachingFeature<unknown, unknown>);
      correctedInputs.push(input);
      if (config.correctiveError) throw config.correctiveError;
      if (!config.correctedResponse) {
        throw new Error("fake session has no corrected response configured");
      }
      return { value: config.correctedResponse as TOutput, retried: false };
    },
    addUserMessage() {},
    addAssistantMessage() {},
    removeLastUserMessage() {},
    reset() {},
  };

  return { session, corrections, correctedFeatures, correctedInputs };
}

describe("buildCorrectiveMessage", () => {
  const rawPath = [
    entry("Boots of Swiftness"),
    entry("Mercury's Treads"),
    entry("Lord Dominik's Regards"),
    entry("Mortal Reminder"),
    entry("Infinity Edge"),
    entry("Infinity Edge"),
  ];
  const dropped: BuildPathDrop[] = [
    {
      kind: "boots-collision",
      entry: entry("Mercury's Treads"),
      keptName: "Boots of Swiftness",
      keptSource: "path",
    },
    {
      kind: "mutex-collision",
      entry: entry("Mortal Reminder"),
      group: "Fatality",
      keptName: "Lord Dominik's Regards",
      keptSource: "path",
    },
    { kind: "duplicate-name", entry: entry("Infinity Edge") },
  ];
  const message = buildCorrectiveMessage(rawPath, dropped);

  it("restates the full offending build path by name", () => {
    for (const name of [
      "Boots of Swiftness",
      "Mercury's Treads",
      "Lord Dominik's Regards",
      "Mortal Reminder",
      "Infinity Edge",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("states the boots rule in task-prompt vocabulary", () => {
    expect(message).toMatch(/at most one Boots item/i);
  });

  it("names the restriction group for a mutex collision", () => {
    expect(message).toContain("Fatality");
    expect(message).toMatch(/restriction group/i);
  });

  it("states the duplicate rule as 'listed twice'", () => {
    expect(message).toMatch(/listed twice/i);
  });

  it("says the player already owns the blocker for inventory collisions", () => {
    const invMessage = buildCorrectiveMessage(
      [entry("Lord Dominik's Regards")],
      [
        {
          kind: "mutex-collision",
          entry: entry("Lord Dominik's Regards"),
          group: "Fatality",
          keptName: "Mortal Reminder",
          keptSource: "inventory",
        },
      ]
    );
    expect(invMessage).toMatch(/already own/i);
    expect(invMessage).toContain("Mortal Reminder");
  });

  it("states mode unavailability with the mode name", () => {
    const modeMessage = buildCorrectiveMessage(
      [entry("Perplexity")],
      [
        {
          kind: "mode-unavailable",
          entry: entry("Perplexity"),
          modeName: "CLASSIC",
        },
      ]
    );
    expect(modeMessage).toMatch(/not purchasable in CLASSIC/i);
  });

  it("instructs a corrected complete plan that keeps legal entries", () => {
    expect(message).toMatch(/corrected/i);
    expect(message).toMatch(/every build path rule/i);
    expect(message).toMatch(/keep.*legal.*unchanged/is);
  });
});

describe("remediateGamePlan", () => {
  it("returns the swept path without any corrective call when legal", async () => {
    const fake = createFakeSession({});
    const response = plan("Build crit.", LEGAL_NAMES);

    const result = await remediateGamePlan({
      session: fake.session,
      feature: gamePlanFeature,
      input: { snapshot: null },
      response,
      items,
      mode: classic,
      ownedItemNames: [],
    });

    expect(fake.corrections).toHaveLength(0);
    expect(result.corrected).toBe(false);
    expect(result.answer).toBe("Build crit.");
    expect(result.buildPath.map((e) => e.name)).toEqual(LEGAL_NAMES);
    expect(result.dropped).toEqual([]);
  });

  it("sends one corrective call naming the violations, then ships the clean retry", async () => {
    const corrected = plan("Fixed: crit build.", LEGAL_NAMES);
    const fake = createFakeSession({ correctedResponse: corrected });
    const response = plan("Build crit.", [
      "Boots of Swiftness",
      "Mercury's Treads",
      "Lord Dominik's Regards",
      "Mortal Reminder",
      "Infinity Edge",
      "Bloodthirster",
    ]);
    const input: GamePlanInput = { snapshot: null };

    const result = await remediateGamePlan({
      session: fake.session,
      feature: gamePlanFeature,
      input,
      response,
      items,
      mode: classic,
      ownedItemNames: [],
    });

    expect(fake.corrections).toHaveLength(1);
    expect(fake.corrections[0]).toContain("Mercury's Treads");
    expect(fake.corrections[0]).toContain("Mortal Reminder");
    expect(fake.corrections[0]).toMatch(/at most one Boots item/i);
    expect(fake.corrections[0]).toMatch(/restriction group/i);
    expect(fake.correctedFeatures[0]).toBe(gamePlanFeature);
    expect(fake.correctedInputs[0]).toBe(input);

    expect(result.corrected).toBe(true);
    expect(result.answer).toBe("Fixed: crit build.");
    expect(result.buildPath.map((e) => e.name)).toEqual(LEGAL_NAMES);
    expect(result.dropped).toEqual([]);
  });

  it("sweeps a still-violating retry and never sends a second correction", async () => {
    const stillIllegal = plan("Take both Last Whispers.", [
      "Lord Dominik's Regards",
      "Mortal Reminder",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
    ]);
    const fake = createFakeSession({ correctedResponse: stillIllegal });
    const response = plan("Boots twice.", [
      "Boots of Swiftness",
      "Mercury's Treads",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
    ]);

    const result = await remediateGamePlan({
      session: fake.session,
      feature: gamePlanFeature,
      input: { snapshot: null },
      response,
      items,
      mode: classic,
      ownedItemNames: [],
    });

    expect(fake.corrections).toHaveLength(1);
    expect(result.corrected).toBe(true);
    expect(result.answer).toBe("Take both Last Whispers.");
    expect(result.buildPath.map((e) => e.name)).toEqual([
      "Lord Dominik's Regards",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
    ]);
    expect(result.dropped.map((d) => d.kind)).toEqual(["mutex-collision"]);
  });

  it("falls back to the first swept result when the corrective call throws", async () => {
    const fake = createFakeSession({
      correctiveError: new Error("model unavailable"),
    });
    const response = plan("Boots twice.", [
      "Boots of Swiftness",
      "Mercury's Treads",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
    ]);

    const result = await remediateGamePlan({
      session: fake.session,
      feature: gamePlanFeature,
      input: { snapshot: null },
      response,
      items,
      mode: classic,
      ownedItemNames: [],
    });

    expect(fake.corrections).toHaveLength(1);
    expect(result.corrected).toBe(false);
    expect(result.answer).toBe("Boots twice.");
    expect(result.buildPath.map((e) => e.name)).toEqual([
      "Boots of Swiftness",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
    ]);
    expect(result.dropped.map((d) => d.kind)).toEqual(["boots-collision"]);
  });

  it("seeds the sweep with owned items on both passes", async () => {
    // Player owns Mortal Reminder: recommending LDR is illegal in BOTH the
    // first response and the retry. The retry here repeats the mistake, so
    // the final path must still be swept against the inventory.
    const stillIllegal = plan("LDR again.", [
      "Lord Dominik's Regards",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
      "Boots of Swiftness",
    ]);
    const fake = createFakeSession({ correctedResponse: stillIllegal });
    const response = plan("LDR first.", [
      "Lord Dominik's Regards",
      "Infinity Edge",
      "Bloodthirster",
      "Essence Reaver",
      "Navori Flickerblade",
      "Boots of Swiftness",
    ]);

    const result = await remediateGamePlan({
      session: fake.session,
      feature: gamePlanFeature,
      input: { snapshot: null },
      response,
      items,
      mode: classic,
      ownedItemNames: ["Mortal Reminder"],
    });

    expect(fake.corrections).toHaveLength(1);
    expect(fake.corrections[0]).toMatch(/already own/i);
    expect(result.corrected).toBe(true);
    expect(result.buildPath.map((e) => e.name)).not.toContain(
      "Lord Dominik's Regards"
    );
    expect(result.dropped.map((d) => d.kind)).toEqual(["mutex-collision"]);
  });
});
