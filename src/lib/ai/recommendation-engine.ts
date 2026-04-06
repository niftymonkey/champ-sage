import { generateText, Output } from "ai";
import type { CoachingResponse } from "./types";
import type { ConversationSession } from "./conversation-session";
import { createCoachingModel, MODEL_CONFIG } from "./model-config";
import { coachingResponseSchema } from "./schemas";
import { getLogger } from "../logger";

const coachingLog = getLogger("coaching:reactive");

/**
 * Multi-turn coaching response using a conversation session.
 *
 * Uses the session's system prompt and message array instead of
 * rebuilding context from scratch on each call.
 */
export async function getMultiTurnCoachingResponse(
  session: ConversationSession,
  apiKey: string,
  options?: { signal?: AbortSignal }
): Promise<CoachingResponse> {
  coachingLog.info(
    `Multi-turn request: ${session.messages.length} messages in thread`,
    { model: MODEL_CONFIG.id }
  );

  const startMs = Date.now();
  const model = createCoachingModel(apiKey);

  try {
    const result = await generateText({
      model,
      system: session.systemPrompt,
      messages: [...session.messages],
      output: Output.object({ schema: coachingResponseSchema }),
      maxOutputTokens: 1024,
      ...(options?.signal ? { abortSignal: options.signal } : {}),
    });

    const elapsedMs = Date.now() - startMs;
    const usage = result.usage;
    const recs = result.output.recommendations;

    coachingLog.info(
      `Response (${elapsedMs}ms): ${usage.inputTokens ?? "?"}in/${usage.outputTokens ?? "?"}out`,
      {
        answer: result.output.answer,
        recommendations: recs.map((r) => r.name),
      }
    );

    return result.output;
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    coachingLog.error("Multi-turn request failed", {
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
