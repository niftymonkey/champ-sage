import { describe, it, expect } from "vitest";
import { buildItemRecCorrectiveMessage, remediateItemRec } from "./remediation";
import type { RecommendationDrop } from "./legality";
import type { ItemRecInput } from "./index";
import type { ItemRecResult } from "./schema";
import type { Recommendation } from "../../types";
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
  makeItem(3020, "Sorcerer's Shoes", { tags: ["Boots"] }),
  makeItem(3031, "Infinity Edge"),
  makeItem(3072, "Bloodthirster"),
  makeItem(6675, "Navori Flickerblade"),
  makeItem(4015, "Perplexity", { maps: [30] }),
]);

function option(
  name: string,
  fit: Recommendation["fit"] = "strong"
): Recommendation {
  return { name, fit, reasoning: "" };
}

function result(answer: string, names: string[]): ItemRecResult {
  return { answer, recommendations: names.map((n) => option(n)) };
}

const LEGAL_NAMES = ["Infinity Edge", "Bloodthirster", "Navori Flickerblade"];

const feature: CoachingFeature<ItemRecInput, ItemRecResult> = {
  id: "item-rec",
  supportedPhases: ["in-game"] as const,
  buildTaskPrompt: () => "",
  buildUserMessage: () => "",
  outputSchema: {} as CoachingFeature<
    ItemRecInput,
    ItemRecResult
  >["outputSchema"],
  extractResult: (raw) => raw,
  summarizeForHistory: (r) => r.answer,
};

interface FakeSessionState {
  session: MatchSession;
  corrections: string[];
  correctedFeatures: Array<CoachingFeature<unknown, unknown>>;
  correctedInputs: unknown[];
  correctedSignals: Array<AbortSignal | undefined>;
}

/**
 * Fake MatchSession whose correctLastAsk records its arguments and either
 * resolves with the configured response or throws the configured error.
 */
function createFakeSession(config: {
  correctedResponse?: ItemRecResult;
  correctiveError?: Error;
}): FakeSessionState {
  const corrections: string[] = [];
  const correctedFeatures: Array<CoachingFeature<unknown, unknown>> = [];
  const correctedInputs: unknown[] = [];
  const correctedSignals: Array<AbortSignal | undefined> = [];

  const session: MatchSession = {
    systemPrompt: "",
    messages: [],
    phase: "in-game" as MatchPhase,
    async ask() {
      throw new Error("ask must not be called during remediation");
    },
    transitionTo() {},
    async correctLastAsk<TInput, TOutput>(
      askFeature: CoachingFeature<TInput, TOutput>,
      input: TInput,
      correction: string,
      askOptions?: { signal?: AbortSignal }
    ): Promise<AskResult<TOutput>> {
      corrections.push(correction);
      correctedFeatures.push(askFeature as CoachingFeature<unknown, unknown>);
      correctedInputs.push(input);
      correctedSignals.push(askOptions?.signal);
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

  return {
    session,
    corrections,
    correctedFeatures,
    correctedInputs,
    correctedSignals,
  };
}

describe("buildItemRecCorrectiveMessage", () => {
  const raw = [
    option("Mortal Reminder"),
    option("Sorcerer's Shoes"),
    option("Infinity Edge"),
  ];
  const dropped: RecommendationDrop[] = [
    {
      kind: "owned-group-collision",
      recommendation: option("Mortal Reminder"),
      group: "Fatality",
      ownedName: "Lord Dominik's Regards",
    },
    {
      kind: "owned-boots-collision",
      recommendation: option("Sorcerer's Shoes"),
      ownedName: "Boots of Swiftness",
    },
  ];
  const message = buildItemRecCorrectiveMessage(raw, dropped);

  it("restates every offered option by name", () => {
    for (const name of [
      "Mortal Reminder",
      "Sorcerer's Shoes",
      "Infinity Edge",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("names the restriction group and the owned blocker", () => {
    expect(message).toContain("Fatality");
    expect(message).toMatch(/restriction group/i);
    expect(message).toContain("Lord Dominik's Regards");
    expect(message).toMatch(/already owns/i);
  });

  it("states the boots rule against the owned pair", () => {
    expect(message).toMatch(/boots/i);
    expect(message).toContain("Boots of Swiftness");
  });

  it("says an owned option buys nothing", () => {
    const owned = buildItemRecCorrectiveMessage(
      [option("Infinity Edge")],
      [
        {
          kind: "already-owned",
          recommendation: option("Infinity Edge"),
          ownedName: "Infinity Edge",
        },
      ]
    );
    expect(owned).toMatch(/already owns Infinity Edge/i);
  });

  it("names the owned evolved form when the base is the option", () => {
    const owned = buildItemRecCorrectiveMessage(
      [option("Manamune")],
      [
        {
          kind: "already-owned",
          recommendation: option("Manamune"),
          ownedName: "Muramana",
        },
      ]
    );
    expect(owned).toContain("Muramana");
    expect(owned).toMatch(/already owns/i);
  });

  it("states mode unavailability with the mode name", () => {
    const modeMessage = buildItemRecCorrectiveMessage(
      [option("Perplexity")],
      [
        {
          kind: "mode-unavailable",
          recommendation: option("Perplexity"),
          modeName: "CLASSIC",
        },
      ]
    );
    expect(modeMessage).toMatch(/not purchasable in CLASSIC/i);
  });

  it("states the duplicate rule for a repeated option", () => {
    const dupMessage = buildItemRecCorrectiveMessage(
      [option("Infinity Edge"), option("Infinity Edge")],
      [
        {
          kind: "duplicate-option",
          recommendation: option("Infinity Edge"),
        },
      ]
    );
    expect(dupMessage).toMatch(/listed twice/i);
  });

  it("instructs corrected options that replace only the violating ones", () => {
    expect(message).toMatch(/corrected options/i);
    expect(message).toMatch(/replace only/i);
    expect(message).toMatch(/answer/i);
  });
});

describe("remediateItemRec", () => {
  it("returns the filtered options without a corrective call when legal", async () => {
    const fake = createFakeSession({});
    const response = result("Both crit items work.", LEGAL_NAMES);

    const remediated = await remediateItemRec({
      session: fake.session,
      feature,
      input: { snapshot: null, question: "what next?" },
      response,
      items,
      mode: classic,
      ownedItemNames: [],
    });

    expect(fake.corrections).toHaveLength(0);
    expect(remediated.corrected).toBe(false);
    expect(remediated.answer).toBe("Both crit items work.");
    expect(remediated.recommendations.map((r) => r.name)).toEqual(LEGAL_NAMES);
    expect(remediated.dropped).toEqual([]);
  });

  it("sends one corrective call naming the violations, then ships the clean retry", async () => {
    const corrected = result("Fixed options.", LEGAL_NAMES);
    const fake = createFakeSession({ correctedResponse: corrected });
    const response = result("Buy Mortal Reminder.", [
      "Mortal Reminder",
      "Infinity Edge",
    ]);
    const input: ItemRecInput = { snapshot: null, question: "what next?" };
    const signal = new AbortController().signal;

    const remediated = await remediateItemRec({
      session: fake.session,
      feature,
      input,
      response,
      items,
      mode: classic,
      ownedItemNames: ["Lord Dominik's Regards"],
      signal,
    });

    expect(fake.corrections).toHaveLength(1);
    expect(fake.corrections[0]).toContain("Mortal Reminder");
    expect(fake.corrections[0]).toContain("Lord Dominik's Regards");
    expect(fake.corrections[0]).toMatch(/restriction group/i);
    expect(fake.correctedFeatures[0]).toBe(feature);
    expect(fake.correctedInputs[0]).toBe(input);
    expect(fake.correctedSignals[0]).toBe(signal);

    expect(remediated.corrected).toBe(true);
    expect(remediated.answer).toBe("Fixed options.");
    expect(remediated.recommendations.map((r) => r.name)).toEqual(LEGAL_NAMES);
    expect(remediated.dropped).toEqual([]);
  });

  it("filters a still-violating retry and never sends a second correction", async () => {
    const stillIllegal = result("Mortal Reminder again.", [
      "Mortal Reminder",
      "Bloodthirster",
    ]);
    const fake = createFakeSession({ correctedResponse: stillIllegal });
    const response = result("Mortal Reminder first.", [
      "Mortal Reminder",
      "Infinity Edge",
    ]);

    const remediated = await remediateItemRec({
      session: fake.session,
      feature,
      input: { snapshot: null, question: "what next?" },
      response,
      items,
      mode: classic,
      ownedItemNames: ["Lord Dominik's Regards"],
    });

    expect(fake.corrections).toHaveLength(1);
    expect(remediated.corrected).toBe(true);
    expect(remediated.answer).toBe("Mortal Reminder again.");
    expect(remediated.recommendations.map((r) => r.name)).toEqual([
      "Bloodthirster",
    ]);
    expect(remediated.dropped.map((d) => d.kind)).toEqual([
      "owned-group-collision",
    ]);
  });

  it("falls back to the first filtered result when the corrective call throws", async () => {
    const fake = createFakeSession({
      correctiveError: new Error("model unavailable"),
    });
    const response = result("Mortal Reminder first.", [
      "Mortal Reminder",
      "Infinity Edge",
    ]);

    const remediated = await remediateItemRec({
      session: fake.session,
      feature,
      input: { snapshot: null, question: "what next?" },
      response,
      items,
      mode: classic,
      ownedItemNames: ["Lord Dominik's Regards"],
    });

    expect(fake.corrections).toHaveLength(1);
    expect(remediated.corrected).toBe(false);
    expect(remediated.answer).toBe("Mortal Reminder first.");
    expect(remediated.recommendations.map((r) => r.name)).toEqual([
      "Infinity Edge",
    ]);
    expect(remediated.dropped.map((d) => d.kind)).toEqual([
      "owned-group-collision",
    ]);
  });

  it("keeps same-group alternatives when the inventory holds neither", async () => {
    const fake = createFakeSession({});
    const response = result("Compare the two Last Whispers.", [
      "Lord Dominik's Regards",
      "Mortal Reminder",
    ]);

    const remediated = await remediateItemRec({
      session: fake.session,
      feature,
      input: { snapshot: null, question: "what next?" },
      response,
      items,
      mode: classic,
      ownedItemNames: [],
    });

    expect(fake.corrections).toHaveLength(0);
    expect(remediated.recommendations.map((r) => r.name)).toEqual([
      "Lord Dominik's Regards",
      "Mortal Reminder",
    ]);
  });
});
