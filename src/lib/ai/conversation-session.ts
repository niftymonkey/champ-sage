/**
 * Manages the multi-turn conversation message array for a game session.
 *
 * Each user message includes a full game state snapshot (not a diff),
 * re-anchoring the LLM to ground truth every turn. The system prompt is
 * set once at session creation and never changes.
 *
 * Usage:
 *   const session = createConversationSession(systemPrompt);
 *   session.addUserMessage(stateSnapshot, question);
 *   // ... call LLM with session.systemPrompt + session.messages ...
 *   session.addAssistantMessage(responseJson);
 */

import type { ModelMessage } from "ai";

export interface ConversationSession {
  readonly systemPrompt: string;
  readonly messages: readonly ModelMessage[];
  addUserMessage(stateSnapshot: string, question: string): void;
  addAssistantMessage(responseText: string): void;
  removeLastUserMessage(): void;
  reset(): void;
}

export function createConversationSession(
  systemPrompt: string
): ConversationSession {
  const messages: ModelMessage[] = [];

  return {
    get systemPrompt() {
      return systemPrompt;
    },

    get messages(): readonly ModelMessage[] {
      return messages;
    },

    addUserMessage(stateSnapshot: string, question: string): void {
      messages.push({
        role: "user",
        content: `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`,
      });
    },

    addAssistantMessage(responseText: string): void {
      messages.push({
        role: "assistant",
        content: responseText,
      });
    },

    removeLastUserMessage(): void {
      if (messages.length === 0) {
        throw new Error("Cannot remove from empty message array");
      }
      const last = messages[messages.length - 1];
      if (last.role !== "user") {
        throw new Error(
          `Last message has role "${last.role}", expected "user"`
        );
      }
      messages.pop();
    },

    reset(): void {
      messages.length = 0;
    },
  };
}
