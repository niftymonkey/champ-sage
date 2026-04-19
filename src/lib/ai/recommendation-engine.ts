import { generateText, Output } from "ai";
import type { CoachingResponse } from "./types";
import type { ConversationSession } from "./conversation-session";
import { createCoachingModel, MODEL_CONFIG } from "./model-config";
import { coachingResponseSchema } from "./schemas";
import { raceWithRetry } from "./race-with-retry";
import { getLogger } from "../logger";

const coachingLog = getLogger("coaching:reactive");

/**
 * If attempt 1 hasn't completed within this window, a second attempt starts
 * racing alongside it. Sized at ~2-3x normal response latency for gpt-5.4-mini.
 */
const SLOW_ATTEMPT_MS = 10_000;

/**
 * Multi-turn coaching response using a conversation session.
 *
 * Uses the session's system prompt and message array instead of
 * rebuilding context from scratch on each call.
 *
 * Failure handling (#102): delegates to `raceWithRetry` so the same racing
 * strategy is available to any other LLM call in the codebase.
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

  const model = createCoachingModel(apiKey);

  const { value, winningAttempt } = await raceWithRetry<CoachingResponse>(
    async ({ attempt, signal }) => {
      const startMs = Date.now();
      const result = await generateText({
        model,
        system: session.systemPrompt,
        messages: [...session.messages],
        output: Output.object({ schema: coachingResponseSchema }),
        maxOutputTokens: 1024,
        abortSignal: signal,
      });

      const elapsedMs = Date.now() - startMs;
      const usage = result.usage;
      const recs = result.output.recommendations;

      coachingLog.info(
        `Response (${elapsedMs}ms${attempt > 1 ? `, attempt ${attempt}` : ""}): ${usage.inputTokens ?? "?"}in/${usage.outputTokens ?? "?"}out`,
        {
          answer: result.output.answer,
          recommendations: recs.map((r) => `${r.name} [${r.fit}]`),
        }
      );

      return result.output;
    },
    {
      signal: options?.signal,
      slowAfterMs: SLOW_ATTEMPT_MS,
      onRetryTrigger: (reason, err) => {
        const trigger =
          reason === "timeout"
            ? `Attempt 1 exceeded ${SLOW_ATTEMPT_MS}ms`
            : `Attempt 1 failed: ${err instanceof Error ? err.message : String(err)}`;
        coachingLog.warn(
          `[RETRY-TRIGGER] ${trigger} — racing a second attempt`
        );
      },
      onRetrySuccess: () => {
        coachingLog.info("[RETRY-SUCCESS] Attempt 2 won the race");
      },
      onBothFailed: (lastError) => {
        coachingLog.error("Multi-turn request failed on both attempts", {
          error:
            lastError instanceof Error ? lastError.message : String(lastError),
        });
      },
    }
  );

  return winningAttempt > 1 ? { ...value, retried: true } : value;
}
