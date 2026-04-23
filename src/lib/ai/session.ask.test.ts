import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jsonSchema } from "ai";
import { createConversationSession } from "./conversation-session";
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
  /** Optional suffix appended after the session base context */
  taskSuffix?: string;
}

const testOutputSchema = jsonSchema<TestOutput>({
  type: "object",
  properties: { answer: { type: "string", description: "test answer" } },
  required: ["answer"],
  additionalProperties: false,
});

function createTestFeature(): CoachingFeature<TestInput, TestOutput> {
  return {
    id: "test",
    supportedPhases: ["in-game"] as const,
    buildTaskPrompt: (input) => input.taskSuffix ?? "",
    buildUserMessage: ({ stateSnapshot, question }) =>
      `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`,
    outputSchema: testOutputSchema,
    extractResult: (raw) => raw,
    summarizeForHistory: (result) => result.answer,
  };
}

function createDeferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("session.ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the session base context as system when the feature task prompt is empty", async () => {
    const { noopPersonality } = await import("./personality");
    const session = createConversationSession("BASE", "test-key", {
      personality: noopPersonality,
    });
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, {
      stateSnapshot: "snap",
      question: "q",
    });

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("BASE");
  });

  it("composes system = base context + feature task prompt", async () => {
    const { noopPersonality } = await import("./personality");
    const session = createConversationSession("BASE", "test-key", {
      personality: noopPersonality,
    });
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, {
      stateSnapshot: "snap",
      question: "q",
      taskSuffix: "\n\nTASK",
    });

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("BASE\n\nTASK");
  });

  it("appends a custom personality suffix after the feature task prompt", async () => {
    const session = createConversationSession("BASE", "test-key", {
      personality: {
        id: "dramatic",
        suffix: () => "DRAMATIC VOICE",
      },
    });
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, {
      stateSnapshot: "snap",
      question: "q",
      taskSuffix: "\n\nTASK",
    });

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("BASE\n\nTASK\n\nDRAMATIC VOICE");
  });

  it("noop personality leaves the system prompt unchanged", async () => {
    const { noopPersonality } = await import("./personality");
    const session = createConversationSession("BASE", "test-key", {
      personality: noopPersonality,
    });
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("BASE");
  });

  it("re-reads personality on every ask when given a function form (mid-session swap)", async () => {
    const { noopPersonality, piratePersonality } =
      await import("./personality");
    let current: typeof noopPersonality = noopPersonality;
    const session = createConversationSession("BASE", "test-key", {
      personality: () => current,
    });
    const feature = createTestFeature();

    mockGenerateText
      .mockResolvedValueOnce({
        output: { answer: "first" },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        output: { answer: "second" },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

    await session.ask(feature, { stateSnapshot: "s1", question: "q1" });
    expect(mockGenerateText.mock.calls[0][0].system).toBe("BASE");

    // Flip personality between asks — next call must pick up the new value.
    current = piratePersonality;

    await session.ask(feature, { stateSnapshot: "s2", question: "q2" });
    expect(mockGenerateText.mock.calls[1][0].system).toContain("pirate");
  });

  it("default personality (brief) appends voice rules after the task prompt", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toMatch(/^BASE\n\nRESPONSE RULES:/);
    expect(callArgs.system).toContain("1-3 sentences maximum");
  });

  it("pushes the feature's user message to history and sends it to generateText", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, {
      stateSnapshot: "Level: 5, Gold: 1200",
      question: "What should I buy?",
    });

    const callArgs = mockGenerateText.mock.calls[0][0];
    const messages = callArgs.messages;
    expect(messages).toHaveLength(1);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[0].content).toBe(
      "[Game State]\nLevel: 5, Gold: 1200\n\n[Question]\nWhat should I buy?"
    );
  });

  it("propagates the caller's abort signal to generateText", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();
    const userController = new AbortController();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "hello" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(
      feature,
      { stateSnapshot: "snap", question: "q" },
      { signal: userController.signal }
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    const downstreamSignal = callArgs.abortSignal;
    expect(downstreamSignal).toBeDefined();
    expect(downstreamSignal).toBeInstanceOf(AbortSignal);
    expect(downstreamSignal!.aborted).toBe(false);
    userController.abort();
    expect(downstreamSignal!.aborted).toBe(true);
  });

  it("tags the result as retried via extractResult when attempt 2 wins", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText
      .mockRejectedValueOnce(
        new Error("No object generated: could not parse the response.")
      )
      .mockResolvedValueOnce({
        output: { answer: "retry-value" },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

    const { value, retried } = await session.ask(feature, {
      stateSnapshot: "snap",
      question: "q",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(value.answer).toBe("retry-value");
    expect(retried).toBe(true);
  });

  it("rolls back the orphaned user message when both attempts fail", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText
      .mockRejectedValueOnce(new Error("parse fail 1"))
      .mockRejectedValueOnce(new Error("parse fail 2"));

    await expect(
      session.ask(feature, { stateSnapshot: "snap", question: "q" })
    ).rejects.toThrow(/parse fail [12]/);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(session.messages).toHaveLength(0);
  });

  it("does not retry on abort errors", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    mockGenerateText.mockRejectedValueOnce(abortErr);

    await expect(
      session.ask(feature, { stateSnapshot: "snap", question: "q" })
    ).rejects.toThrow();
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(session.messages).toHaveLength(0);
  });

  it("does not tag as retried when attempt 1 succeeds", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "fast" },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const { value, retried } = await session.ask(feature, {
      stateSnapshot: "snap",
      question: "q",
    });

    expect(value.answer).toBe("fast");
    expect(retried).toBe(false);
  });

  it("carries conversation history across multiple ask() calls", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText
      .mockResolvedValueOnce({
        output: { answer: "first" },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        output: { answer: "second" },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

    await session.ask(feature, { stateSnapshot: "s1", question: "q1" });
    await session.ask(feature, { stateSnapshot: "s2", question: "q2" });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const secondCall = mockGenerateText.mock.calls[1][0];
    const messages = secondCall.messages;
    expect(messages).toHaveLength(3);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[1].role).toBe("assistant");
    expect(messages?.[2].role).toBe("user");
    expect(session.messages).toHaveLength(4);
    expect(session.messages[3].role).toBe("assistant");
  });

  it("stores the feature's summarizeForHistory output as the assistant turn", async () => {
    const session = createConversationSession("BASE", "test-key");
    const feature = createTestFeature();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "Buy Thornmail next." },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await session.ask(feature, { stateSnapshot: "snap", question: "q" });

    const assistantTurn = session.messages[1];
    expect(assistantTurn.role).toBe("assistant");
    expect(assistantTurn.content).toBe("Buy Thornmail next.");
  });

  describe("racing timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts attempt 2 after 10s if attempt 1 still pending", async () => {
      const session = createConversationSession("BASE", "test-key");
      const feature = createTestFeature();

      const deferredA = createDeferred();
      mockGenerateText.mockReturnValueOnce(deferredA.promise as never);
      mockGenerateText.mockResolvedValueOnce({
        output: { answer: "from-attempt-2" },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

      const resultPromise = session.ask(feature, {
        stateSnapshot: "snap",
        question: "q",
      });

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);

      const { value, retried } = await resultPromise;
      expect(value.answer).toBe("from-attempt-2");
      expect(retried).toBe(true);

      deferredA.resolve({ output: { answer: "too-late" } });
    });

    it("returns attempt 1's result if it wins the race against attempt 2", async () => {
      const session = createConversationSession("BASE", "test-key");
      const feature = createTestFeature();

      const deferredA = createDeferred();
      const deferredB = createDeferred();
      mockGenerateText.mockReturnValueOnce(deferredA.promise as never);
      mockGenerateText.mockReturnValueOnce(deferredB.promise as never);

      const resultPromise = session.ask(feature, {
        stateSnapshot: "snap",
        question: "q",
      });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);

      deferredA.resolve({
        output: { answer: "from-attempt-1" },
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const { value, retried } = await resultPromise;
      expect(value.answer).toBe("from-attempt-1");
      expect(retried).toBe(false);

      deferredB.resolve({ output: { answer: "too-late" } });
    });
  });
});
