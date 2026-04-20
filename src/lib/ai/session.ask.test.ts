import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConversationSession } from "./conversation-session";
import { coachingFeature } from "./features/coaching";

// Mock the ai module to intercept generateText calls
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

// Mock model-config to avoid needing a real API key
vi.mock("./model-config", () => ({
  createCoachingModel: () => "mock-model",
  MODEL_CONFIG: { id: "test-model", name: "Test" },
}));

import { generateText } from "ai";

const mockGenerateText = vi.mocked(generateText);

function createDeferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("session.ask(coachingFeature)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("composes system from session prompt + feature task prompt, and pushes the feature's user message", async () => {
    const session = createConversationSession("You are a coach.", "test-key");

    mockGenerateText.mockResolvedValueOnce({
      output: {
        answer: "Buy Rabadon's Deathcap.",
        recommendations: [
          {
            name: "Rabadon's Deathcap",
            fit: "strong",
            reasoning: "High AP scaling",
          },
        ],
        buildPath: null,
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const response = await session.ask(coachingFeature, {
      stateSnapshot: "Level: 5, Gold: 1200",
      question: "What should I buy?",
    });

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0];
    // Kitchen-sink feature contributes an empty task prompt in Phase 1,
    // so the composed system is the session's base context unchanged.
    expect(callArgs.system).toBe("You are a coach.");
    expect(callArgs).not.toHaveProperty("prompt");

    const messages = callArgs.messages;
    expect(messages).toBeDefined();
    expect(messages).toHaveLength(1);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[0].content).toBe(
      "[Game State]\nLevel: 5, Gold: 1200\n\n[Question]\nWhat should I buy?"
    );

    expect(response.answer).toBe("Buy Rabadon's Deathcap.");
    expect(response.recommendations).toHaveLength(1);
  });

  it("propagates the caller's abort signal to generateText", async () => {
    const session = createConversationSession("Coach prompt", "test-key");
    const userController = new AbortController();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "Answer", recommendations: [], buildPath: null },
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    await session.ask(
      coachingFeature,
      { stateSnapshot: "State", question: "Question" },
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

  it("falls back to attempt 2 when attempt 1 throws a non-abort error, and tags response as retried", async () => {
    const session = createConversationSession("Coach prompt", "test-key");

    mockGenerateText
      .mockRejectedValueOnce(
        new Error("No object generated: could not parse the response.")
      )
      .mockResolvedValueOnce({
        output: {
          answer: "Retry worked",
          recommendations: [],
          buildPath: null,
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      } as never);

    const response = await session.ask(coachingFeature, {
      stateSnapshot: "State",
      question: "Question",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(response.answer).toBe("Retry worked");
    expect(response.retried).toBe(true);
  });

  it("throws after both attempts fail and rolls back the orphaned user message", async () => {
    const session = createConversationSession("Coach prompt", "test-key");

    mockGenerateText
      .mockRejectedValueOnce(new Error("parse fail 1"))
      .mockRejectedValueOnce(new Error("parse fail 2"));

    await expect(
      session.ask(coachingFeature, {
        stateSnapshot: "State",
        question: "Question",
      })
    ).rejects.toThrow(/parse fail [12]/);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(session.messages).toHaveLength(0);
  });

  it("does not retry on abort errors", async () => {
    const session = createConversationSession("Coach prompt", "test-key");

    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    mockGenerateText.mockRejectedValueOnce(abortErr);

    await expect(
      session.ask(coachingFeature, {
        stateSnapshot: "State",
        question: "Question",
      })
    ).rejects.toThrow();
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    // Orphaned user message is rolled back so the session stays clean
    expect(session.messages).toHaveLength(0);
  });

  it("does NOT tag as retried when attempt 1 succeeds", async () => {
    const session = createConversationSession("Coach prompt", "test-key");

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "Fast answer", recommendations: [], buildPath: null },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const response = await session.ask(coachingFeature, {
      stateSnapshot: "State",
      question: "Question",
    });

    expect(response.retried).toBeUndefined();
  });

  it("carries conversation history across multiple ask() calls", async () => {
    const session = createConversationSession("Coach prompt", "test-key");

    mockGenerateText
      .mockResolvedValueOnce({
        output: {
          answer: "First answer",
          recommendations: [],
          buildPath: null,
        },
        usage: { inputTokens: 100, outputTokens: 30 },
      } as never)
      .mockResolvedValueOnce({
        output: {
          answer: "Follow-up answer",
          recommendations: [],
          buildPath: null,
        },
        usage: { inputTokens: 200, outputTokens: 30 },
      } as never);

    await session.ask(coachingFeature, {
      stateSnapshot: "State 1",
      question: "First question",
    });
    await session.ask(coachingFeature, {
      stateSnapshot: "State 2",
      question: "Follow-up question",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const secondCall = mockGenerateText.mock.calls[1][0];
    const messages = secondCall.messages;
    expect(messages).toHaveLength(3);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[1].role).toBe("assistant");
    expect(messages?.[2].role).toBe("user");

    // Session history mirrors what's sent: user, assistant, user, assistant
    expect(session.messages).toHaveLength(4);
    expect(session.messages[3].role).toBe("assistant");
  });

  it("stores the assistant turn as stringified result when no summarizeForHistory is provided", async () => {
    const session = createConversationSession("Coach prompt", "test-key");

    mockGenerateText.mockResolvedValueOnce({
      output: {
        answer: "hello",
        recommendations: [],
        buildPath: null,
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    } as never);

    await session.ask(coachingFeature, {
      stateSnapshot: "State",
      question: "Question",
    });

    const assistantTurn = session.messages[1];
    expect(assistantTurn.role).toBe("assistant");
    expect(typeof assistantTurn.content).toBe("string");
    expect(assistantTurn.content).toContain('"answer":"hello"');
  });

  describe("racing timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts attempt 2 after 10s if attempt 1 still pending", async () => {
      const session = createConversationSession("Coach prompt", "test-key");

      const deferredA = createDeferred();
      mockGenerateText.mockReturnValueOnce(deferredA.promise as never);
      mockGenerateText.mockResolvedValueOnce({
        output: {
          answer: "From attempt 2",
          recommendations: [],
          buildPath: null,
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      } as never);

      const resultPromise = session.ask(coachingFeature, {
        stateSnapshot: "State",
        question: "Question",
      });

      expect(mockGenerateText).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_001);

      expect(mockGenerateText).toHaveBeenCalledTimes(2);

      const response = await resultPromise;
      expect(response.answer).toBe("From attempt 2");
      expect(response.retried).toBe(true);

      deferredA.resolve({
        output: { answer: "too late", recommendations: [], buildPath: null },
      });
    });

    it("returns attempt 1's response if it wins the race against attempt 2", async () => {
      const session = createConversationSession("Coach prompt", "test-key");

      const deferredA = createDeferred();
      const deferredB = createDeferred();
      mockGenerateText.mockReturnValueOnce(deferredA.promise as never);
      mockGenerateText.mockReturnValueOnce(deferredB.promise as never);

      const resultPromise = session.ask(coachingFeature, {
        stateSnapshot: "State",
        question: "Question",
      });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);

      deferredA.resolve({
        output: {
          answer: "From attempt 1",
          recommendations: [],
          buildPath: null,
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      });

      const response = await resultPromise;
      expect(response.answer).toBe("From attempt 1");
      expect(response.retried).toBeUndefined();

      deferredB.resolve({
        output: { answer: "too late", recommendations: [], buildPath: null },
      });
    });
  });
});
