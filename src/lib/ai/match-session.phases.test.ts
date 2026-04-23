import { describe, it, expect, vi, beforeEach } from "vitest";
import { jsonSchema } from "ai";
import { createMatchSession } from "./match-session";
import type { CoachingFeature, MatchPhase } from "./feature";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("./model-config", () => ({
  createCoachingModel: () => "mock-model",
  MODEL_CONFIG: { id: "test-model", name: "Test" },
}));

import { generateText } from "ai";
const mockGenerateText = vi.mocked(generateText);

interface TestOutput {
  answer: string;
}

const testSchema = jsonSchema<TestOutput>({
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
});

function createFeature(
  id: string,
  supportedPhases: readonly MatchPhase[]
): CoachingFeature<{ q: string }, TestOutput> {
  return {
    id,
    supportedPhases,
    buildTaskPrompt: () => "",
    buildUserMessage: ({ q }) => q,
    outputSchema: testSchema,
    extractResult: (raw) => raw,
    summarizeForHistory: (r) => r.answer,
  };
}

describe("MatchSession phases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to phase 'in-game' when no phase is specified", () => {
    const session = createMatchSession("BASE", "test-key");
    expect(session.phase).toBe("in-game");
  });

  it("respects an explicit initial phase", () => {
    const session = createMatchSession("BASE", "test-key", {
      phase: "champ-select",
    });
    expect(session.phase).toBe("champ-select");
  });

  it("transitionTo updates phase and swaps the system prompt", () => {
    const session = createMatchSession("CHAMP-SELECT-BASE", "test-key", {
      phase: "champ-select",
    });
    expect(session.phase).toBe("champ-select");
    expect(session.systemPrompt).toBe("CHAMP-SELECT-BASE");

    session.transitionTo("in-game", "IN-GAME-BASE");

    expect(session.phase).toBe("in-game");
    expect(session.systemPrompt).toBe("IN-GAME-BASE");
  });

  it("transitionTo preserves accumulated message history", () => {
    const session = createMatchSession("BASE-1", "test-key", {
      phase: "champ-select",
    });
    session.addUserMessage("snap", "first question");
    session.addAssistantMessage("first answer");
    session.addUserMessage("snap", "second question");
    session.addAssistantMessage("second answer");

    expect(session.messages).toHaveLength(4);

    session.transitionTo("in-game", "BASE-2");

    // Both that messages survived AND that the transition actually fired.
    // Without the latter, a no-op transitionTo would trivially "preserve"
    // history because it never touched it.
    expect(session.phase).toBe("in-game");
    expect(session.systemPrompt).toBe("BASE-2");
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0].content).toContain("first question");
    expect(session.messages[3].content).toBe("second answer");
  });

  it("ask() throws when feature does not support the current phase", async () => {
    const session = createMatchSession("BASE", "test-key", {
      phase: "champ-select",
    });
    const inGameOnly = createFeature("in-game-only", ["in-game"]);

    await expect(session.ask(inGameOnly, { q: "anything" })).rejects.toThrow(
      /does not support phase "champ-select"/
    );
  });

  it("ask() does not push a user turn when the phase check throws", async () => {
    const session = createMatchSession("BASE", "test-key", {
      phase: "post-game",
    });
    const inGameOnly = createFeature("in-game-only", ["in-game"]);

    // Tighten the regex so the test fails if SOMETHING else throws (e.g.
    // the engine call rolling back after a downstream failure). The point
    // of this test is the phase check specifically, not generic rollback.
    await expect(session.ask(inGameOnly, { q: "anything" })).rejects.toThrow(
      /does not support phase "post-game"/
    );

    expect(session.messages).toHaveLength(0);
  });

  it("ask() succeeds after transitionTo into a supported phase", async () => {
    const session = createMatchSession("CHAMP-SELECT", "test-key", {
      phase: "champ-select",
    });
    const inGameOnly = createFeature("in-game-only", ["in-game"]);

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "ok" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    // First call from champ-select must throw.
    await expect(session.ask(inGameOnly, { q: "anything" })).rejects.toThrow();

    // After transition, the same feature now succeeds.
    session.transitionTo("in-game", "IN-GAME");
    const { value } = await session.ask(inGameOnly, { q: "now-ok" });
    expect(value.answer).toBe("ok");
  });

  it("multi-phase feature works in every declared phase", async () => {
    const session = createMatchSession("CHAMP-CONTEXT", "test-key", {
      phase: "champ-select",
    });
    const universalFeature = createFeature("universal", [
      "champ-select",
      "in-game",
      "post-game",
    ]);

    mockGenerateText.mockResolvedValue({
      output: { answer: "ok" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    // Each ask must observe the phase the session was actually in when
    // dispatched. Asserting on session.phase at the point of the call
    // prevents passing with a no-op transitionTo (which would leave the
    // session permanently in "champ-select" and let a multi-phase feature
    // succeed regardless).
    expect(session.phase).toBe("champ-select");
    await expect(
      session.ask(universalFeature, { q: "champ" })
    ).resolves.toBeDefined();

    session.transitionTo("in-game", "GAME-CONTEXT");
    expect(session.phase).toBe("in-game");
    expect(session.systemPrompt).toBe("GAME-CONTEXT");
    await expect(
      session.ask(universalFeature, { q: "game" })
    ).resolves.toBeDefined();

    session.transitionTo("post-game", "POST-CONTEXT");
    expect(session.phase).toBe("post-game");
    expect(session.systemPrompt).toBe("POST-CONTEXT");
    await expect(
      session.ask(universalFeature, { q: "post" })
    ).resolves.toBeDefined();
  });
});
