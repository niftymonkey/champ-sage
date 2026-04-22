/**
 * Manages the multi-turn conversation message array for a game session.
 *
 * Each user message includes a full game state snapshot (not a diff),
 * re-anchoring the LLM to ground truth every turn. The system prompt is
 * set once at session creation and composed per-call with the feature's
 * task prompt.
 *
 * Usage:
 *   const session = createConversationSession(systemPrompt, apiKey);
 *   const { value, retried } = await session.ask(someFeature, input);
 */

import type { LanguageModel, ModelMessage } from "ai";
import type { AskResult, CoachingFeature } from "./feature";
import { runFeatureCall } from "./recommendation-engine";
import { getLogger } from "../logger";

const sessionLog = getLogger("coaching:session");

export interface CreateConversationSessionOptions {
  /**
   * Optional model override applied to every `session.ask()` call. When
   * omitted, the engine resolves the production model via the apiKey.
   * Match-scoped: one provider for the session's lifetime. The eval harness
   * sets this to swap providers (OpenRouter) without forking call paths.
   */
  readonly model?: LanguageModel;
}

export interface ConversationSession {
  readonly systemPrompt: string;
  readonly messages: readonly ModelMessage[];

  /**
   * Feature-typed LLM call. Composes the system prompt (session base +
   * feature task), appends the feature's user message to history, invokes
   * the engine, appends the assistant turn, and returns the result wrapped
   * in an `AskResult` envelope (`{ value, retried }`). On failure, rolls
   * back the orphaned user turn so history stays clean and the same
   * session is safe to reuse.
   */
  ask<TInput, TOutput>(
    feature: CoachingFeature<TInput, TOutput>,
    input: TInput,
    options?: { signal?: AbortSignal }
  ): Promise<AskResult<TOutput>>;

  /**
   * Lower-level history primitives. Used by tests and fixture-replay tooling
   * to seed a session from prior-turn artifacts without mocking the engine.
   */
  addUserMessage(stateSnapshot: string, question: string): void;
  addAssistantMessage(responseText: string): void;
  removeLastUserMessage(): void;
  reset(): void;
}

function formatUserContent(stateSnapshot: string, question: string): string {
  return `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`;
}

export function createConversationSession(
  systemPrompt: string,
  apiKey: string,
  options: CreateConversationSessionOptions = {}
): ConversationSession {
  const messages: ModelMessage[] = [];
  const modelOverride = options.model;

  sessionLog.info(`Session created. baseContext=${systemPrompt.length} chars`);

  return {
    get systemPrompt() {
      return systemPrompt;
    },

    get messages(): readonly ModelMessage[] {
      return messages;
    },

    async ask(feature, input, options) {
      const taskPrompt = feature.buildTaskPrompt(input);
      const system = systemPrompt + taskPrompt;
      const userContent = feature.buildUserMessage(input);

      sessionLog.info(
        `[${feature.id}] ask: base=${systemPrompt.length} task=${taskPrompt.length} total=${system.length} chars, history=${messages.length} msgs`
      );

      messages.push({ role: "user", content: userContent });

      try {
        const { value: raw, retried } = await runFeatureCall({
          feature,
          system,
          messages,
          apiKey,
          signal: options?.signal,
          model: modelOverride,
        });

        const result = feature.extractResult(raw);

        messages.push({
          role: "assistant",
          content: feature.summarizeForHistory(result),
        });

        return { value: result, retried };
      } catch (err) {
        const last = messages[messages.length - 1];
        if (last?.role === "user" && last.content === userContent) {
          messages.pop();
        }
        throw err;
      }
    },

    addUserMessage(stateSnapshot: string, question: string): void {
      messages.push({
        role: "user",
        content: formatUserContent(stateSnapshot, question),
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
