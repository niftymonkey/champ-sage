import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("passes abort signal when provided", async () => {
    const session = createConversationSession("Coach prompt");
    session.addUserMessage("State", "Question");

    const controller = new AbortController();

    mockGenerateText.mockResolvedValueOnce({
      output: {
        answer: "Answer",
        recommendations: [],
      },
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    await getMultiTurnCoachingResponse(session, "test-key", {
      signal: controller.signal,
    });

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.abortSignal).toBe(controller.signal);
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
});
