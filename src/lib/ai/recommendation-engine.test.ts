import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getMultiTurnCoachingResponse } from "./recommendation-engine";
import { createConversationSession } from "./conversation-session";

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

describe("getMultiTurnCoachingResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText with system prompt and messages from session", async () => {
    const session = createConversationSession("You are a coach.");
    session.addUserMessage("Level: 5, Gold: 1200", "What should I buy?");

    mockGenerateText.mockResolvedValueOnce({
      output: {
        answer: "Buy Rabadon's Deathcap.",
        recommendations: [
          { name: "Rabadon's Deathcap", reasoning: "High AP scaling" },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const response = await getMultiTurnCoachingResponse(
      session,
      "test-api-key"
    );

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("You are a coach.");
    expect(callArgs).not.toHaveProperty("prompt");

    const messages = callArgs.messages;
    expect(messages).toBeDefined();
    expect(messages).toHaveLength(1);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[0].content).toContain("What should I buy?");

    expect(response.answer).toBe("Buy Rabadon's Deathcap.");
    expect(response.recommendations).toHaveLength(1);
  });

  it("propagates user abort to the generateText call", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State", "Question");

    const userController = new AbortController();

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "Answer", recommendations: [] },
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    await getMultiTurnCoachingResponse(session, "test-key", {
      signal: userController.signal,
    });

    // A fresh AbortSignal is threaded through — not the user's signal directly,
    // because we link it so internal timeouts can abort independently.
    const callArgs = mockGenerateText.mock.calls[0][0];
    const downstreamSignal = callArgs.abortSignal;
    expect(downstreamSignal).toBeDefined();
    expect(downstreamSignal).toBeInstanceOf(AbortSignal);
    // Aborting the user's signal should abort the downstream signal
    expect(downstreamSignal!.aborted).toBe(false);
    userController.abort();
    expect(downstreamSignal!.aborted).toBe(true);
  });

  it("falls back to attempt 2 when attempt 1 throws a non-abort error, and tags response as retried", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State", "Question");

    mockGenerateText
      .mockRejectedValueOnce(
        new Error("No object generated: could not parse the response.")
      )
      .mockResolvedValueOnce({
        output: { answer: "Retry worked", recommendations: [] },
        usage: { inputTokens: 50, outputTokens: 20 },
      } as never);

    const response = await getMultiTurnCoachingResponse(session, "test-key");

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(response.answer).toBe("Retry worked");
    expect(response.retried).toBe(true);
  });

  it("throws after both attempts fail", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State", "Question");

    mockGenerateText
      .mockRejectedValueOnce(new Error("parse fail 1"))
      .mockRejectedValueOnce(new Error("parse fail 2"));

    await expect(
      getMultiTurnCoachingResponse(session, "test-key")
    ).rejects.toThrow(/parse fail [12]/);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("does not retry on abort errors", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State", "Question");

    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    mockGenerateText.mockRejectedValueOnce(abortErr);

    await expect(
      getMultiTurnCoachingResponse(session, "test-key")
    ).rejects.toThrow();
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("does NOT tag as retried when attempt 1 succeeds", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State", "Question");

    mockGenerateText.mockResolvedValueOnce({
      output: { answer: "Fast answer", recommendations: [] },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const response = await getMultiTurnCoachingResponse(session, "test-key");

    expect(response.retried).toBeUndefined();
  });

  it("includes conversation history across multiple turns", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State 1", "First question");
    session.addAssistantMessage('{"answer":"First answer"}');
    session.addUserMessage("State 2", "Follow-up question");

    mockGenerateText.mockResolvedValueOnce({
      output: {
        answer: "Follow-up answer",
        recommendations: [],
      },
      usage: { inputTokens: 200, outputTokens: 30 },
    } as never);

    await getMultiTurnCoachingResponse(session, "test-key");

    const callArgs = mockGenerateText.mock.calls[0][0];
    const messages = callArgs.messages;
    expect(messages).toBeDefined();
    expect(messages).toHaveLength(3);
    expect(messages?.[0].role).toBe("user");
    expect(messages?.[1].role).toBe("assistant");
    expect(messages?.[2].role).toBe("user");
  });

  describe("racing timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts attempt 2 after 10s if attempt 1 still pending", async () => {
      const session = createConversationSession("Coach prompt");
      session.addUserMessage("State", "Question");

      // Attempt 1 never resolves; attempt 2 resolves immediately
      const deferredA = createDeferred();
      mockGenerateText.mockReturnValueOnce(deferredA.promise as never);
      mockGenerateText.mockResolvedValueOnce({
        output: { answer: "From attempt 2", recommendations: [] },
        usage: { inputTokens: 50, outputTokens: 20 },
      } as never);

      const resultPromise = getMultiTurnCoachingResponse(session, "test-key");

      // Attempt 1 has started
      expect(mockGenerateText).toHaveBeenCalledTimes(1);

      // Advance past the 10s threshold
      await vi.advanceTimersByTimeAsync(10_001);

      // Attempt 2 should now be running
      expect(mockGenerateText).toHaveBeenCalledTimes(2);

      const response = await resultPromise;
      expect(response.answer).toBe("From attempt 2");
      expect(response.retried).toBe(true);

      // Clean up dangling promise
      deferredA.resolve({
        output: { answer: "too late", recommendations: [] },
      });
    });

    it("returns attempt 1's response if it wins the race against attempt 2", async () => {
      const session = createConversationSession("Coach prompt");
      session.addUserMessage("State", "Question");

      const deferredA = createDeferred();
      const deferredB = createDeferred();
      mockGenerateText.mockReturnValueOnce(deferredA.promise as never);
      mockGenerateText.mockReturnValueOnce(deferredB.promise as never);

      const resultPromise = getMultiTurnCoachingResponse(session, "test-key");
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);

      // A resolves first
      deferredA.resolve({
        output: { answer: "From attempt 1", recommendations: [] },
        usage: { inputTokens: 50, outputTokens: 20 },
      });

      const response = await resultPromise;
      expect(response.answer).toBe("From attempt 1");
      expect(response.retried).toBeUndefined();

      // Drain B so it doesn't leak
      deferredB.resolve({
        output: { answer: "too late", recommendations: [] },
      });
    });
  });
});
