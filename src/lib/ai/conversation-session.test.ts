import { describe, it, expect } from "vitest";
import { createConversationSession } from "./conversation-session";

const API_KEY = "test-api-key";

describe("createConversationSession", () => {
  const SYSTEM_PROMPT = "You are a coaching AI.";

  it("starts with empty messages", () => {
    const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
    expect(session.messages).toEqual([]);
  });

  it("preserves the system prompt", () => {
    const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
    expect(session.systemPrompt).toBe(SYSTEM_PROMPT);
  });

  it("adds a user message with state snapshot and question", () => {
    const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
    session.addUserMessage("Level: 5\nGold: 1200", "What should I buy?");

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[0].content).toBe(
      "[Game State]\nLevel: 5\nGold: 1200\n\n[Question]\nWhat should I buy?"
    );
  });

  it("adds an assistant message", () => {
    const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
    session.addUserMessage("Level: 5", "What should I buy?");
    session.addAssistantMessage('{"answer":"Buy Rabadon\'s."}');

    expect(session.messages).toHaveLength(2);
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[1].content).toBe('{"answer":"Buy Rabadon\'s."}');
  });

  it("grows the message array across multiple turns", () => {
    const session = createConversationSession(SYSTEM_PROMPT, API_KEY);

    session.addUserMessage("State 1", "Question 1");
    session.addAssistantMessage("Answer 1");
    session.addUserMessage("State 2", "Question 2");
    session.addAssistantMessage("Answer 2");
    session.addUserMessage("State 3", "Question 3");

    expect(session.messages).toHaveLength(5);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[2].role).toBe("user");
    expect(session.messages[3].role).toBe("assistant");
    expect(session.messages[4].role).toBe("user");
  });

  describe("removeLastUserMessage", () => {
    it("removes the last message when it is a user message", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
      session.addUserMessage("State", "Question");
      session.removeLastUserMessage();

      expect(session.messages).toHaveLength(0);
    });

    it("removes only the last user message, preserving earlier messages", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
      session.addUserMessage("State 1", "Q1");
      session.addAssistantMessage("A1");
      session.addUserMessage("State 2", "Q2");

      session.removeLastUserMessage();

      expect(session.messages).toHaveLength(2);
      expect(session.messages[0].role).toBe("user");
      expect(session.messages[1].role).toBe("assistant");
    });

    it("throws if the last message is not a user message", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
      session.addUserMessage("State", "Q");
      session.addAssistantMessage("A");

      expect(() => session.removeLastUserMessage()).toThrow(
        'Last message has role "assistant", expected "user"'
      );
    });

    it("throws if messages array is empty", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);

      expect(() => session.removeLastUserMessage()).toThrow(
        "Cannot remove from empty message array"
      );
    });
  });

  describe("reset", () => {
    it("clears all messages", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
      session.addUserMessage("State", "Q");
      session.addAssistantMessage("A");

      session.reset();

      expect(session.messages).toHaveLength(0);
    });

    it("preserves the system prompt after reset", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
      session.addUserMessage("State", "Q");
      session.reset();

      expect(session.systemPrompt).toBe(SYSTEM_PROMPT);
    });

    it("allows new messages after reset", () => {
      const session = createConversationSession(SYSTEM_PROMPT, API_KEY);
      session.addUserMessage("State 1", "Q1");
      session.reset();
      session.addUserMessage("State 2", "Q2");

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toContain("State 2");
    });
  });
});
