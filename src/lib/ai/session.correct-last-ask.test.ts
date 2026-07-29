import { describe, it, expect, vi, beforeEach } from "vitest";
import { jsonSchema } from "ai";
import { createMatchSession } from "./match-session";
import type { CoachingFeature } from "./feature";

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

interface TestInput {
  stateSnapshot: string;
  question: string;
  taskSuffix?: string;
}

const testOutputSchema = jsonSchema<TestOutput>({
  type: "object",
  properties: { answer: { type: "string", description: "test answer" } },
  required: ["answer"],
  additionalProperties: false,
});

function createTestFeature(
  id = "test"
): CoachingFeature<TestInput, TestOutput> {
  return {
    id,
    supportedPhases: ["in-game"] as const,
    buildTaskPrompt: (input) => input.taskSuffix ?? "",
    buildUserMessage: ({ stateSnapshot, question }) =>
      `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`,
    outputSchema: testOutputSchema,
    extractResult: (raw) => raw,
    summarizeForHistory: (result) => result.answer,
  };
}

function mockAnswerOnce(answer: string) {
  mockGenerateText.mockResolvedValueOnce({
    output: { answer },
    usage: { inputTokens: 10, outputTokens: 5 },
  } as never);
}

describe("session.correctLastAsk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the session has no prior ask", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    await expect(
      session.correctLastAsk(
        feature,
        { stateSnapshot: "snap", question: "q" },
        "fix it"
      )
    ).rejects.toThrow(/prior ask|assistant/i);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("throws when the last history message is not an assistant turn", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });
    session.addUserMessage("snap2", "another question");

    await expect(
      session.correctLastAsk(
        feature,
        { stateSnapshot: "snap", question: "q" },
        "fix it"
      )
    ).rejects.toThrow(/prior ask|assistant/i);
  });

  it("throws when the prior ask came from a different feature", async () => {
    const session = createMatchSession("BASE", "test-key");
    const featureA = createTestFeature("feature-a");
    const featureB = createTestFeature("feature-b");

    mockAnswerOnce("first");
    await session.ask(featureA, { stateSnapshot: "snap", question: "q" });

    await expect(
      session.correctLastAsk(
        featureB,
        { stateSnapshot: "snap", question: "q" },
        "fix it"
      )
    ).rejects.toThrow(/feature-b/);
  });

  it("throws after a manual history append invalidates the last ask", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });
    session.addAssistantMessage("manually seeded turn");

    await expect(
      session.correctLastAsk(
        feature,
        { stateSnapshot: "snap", question: "q" },
        "fix it"
      )
    ).rejects.toThrow(/prior ask|assistant/i);
  });

  it("sends prior history plus a transient correction turn to the engine", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    mockAnswerOnce("corrected");
    await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q" },
      "Your build path is illegal. Fix it."
    );

    const secondCall = mockGenerateText.mock.calls[1][0];
    const sent = secondCall.messages;
    expect(sent).toHaveLength(3);
    expect(sent?.[0].role).toBe("user");
    expect(sent?.[1]).toEqual({ role: "assistant", content: "first" });
    expect(sent?.[2]).toEqual({
      role: "user",
      content: "Your build path is illegal. Fix it.",
    });
  });

  it("composes the same system prompt ask would build", async () => {
    const { noopPersonality } = await import("./personality");
    const session = createMatchSession("BASE", "test-key", {
      personality: noopPersonality,
    });
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, {
      stateSnapshot: "snap",
      question: "q",
      taskSuffix: "\n\nTASK",
    });

    mockAnswerOnce("corrected");
    await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q", taskSuffix: "\n\nTASK" },
      "fix it"
    );

    const secondCall = mockGenerateText.mock.calls[1][0];
    expect(secondCall.system).toBe("BASE\n\nTASK");
  });

  it("replaces the last assistant turn and does not persist the correction", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    mockAnswerOnce("corrected");
    await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q" },
      "fix it"
    );

    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1]).toEqual({
      role: "assistant",
      content: "corrected",
    });
  });

  it("returns the corrected result", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    mockAnswerOnce("corrected");
    const { value, retried } = await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q" },
      "fix it"
    );

    expect(value).toEqual({ answer: "corrected" });
    expect(retried).toBe(false);
  });

  it("supports a second correction after a successful one", async () => {
    // The replacement keeps the [user, assistant] shape and the same
    // feature, so the corrected turn is itself correctable.
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    mockAnswerOnce("second");
    await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q" },
      "fix it"
    );

    mockAnswerOnce("third");
    await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q" },
      "fix it again"
    );

    expect(session.messages).toHaveLength(2);
    expect(session.messages[1]).toEqual({
      role: "assistant",
      content: "third",
    });
  });

  it("leaves history untouched and rethrows when the corrective call fails", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    mockGenerateText
      .mockRejectedValueOnce(new Error("parse fail 1"))
      .mockRejectedValueOnce(new Error("parse fail 2"));

    await expect(
      session.correctLastAsk(
        feature,
        { stateSnapshot: "snap", question: "q" },
        "fix it"
      )
    ).rejects.toThrow(/parse fail [12]/);

    expect(session.messages).toHaveLength(2);
    expect(session.messages[1]).toEqual({
      role: "assistant",
      content: "first",
    });
  });

  it("propagates the caller's abort signal to the engine", async () => {
    const session = createMatchSession("BASE", "test-key");
    const feature = createTestFeature();
    const controller = new AbortController();

    mockAnswerOnce("first");
    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    mockAnswerOnce("corrected");
    await session.correctLastAsk(
      feature,
      { stateSnapshot: "snap", question: "q" },
      "fix it",
      { signal: controller.signal }
    );

    const secondCall = mockGenerateText.mock.calls[1][0];
    const downstreamSignal = secondCall.abortSignal;
    expect(downstreamSignal).toBeInstanceOf(AbortSignal);
    expect(downstreamSignal!.aborted).toBe(false);
    controller.abort();
    expect(downstreamSignal!.aborted).toBe(true);
  });
});
