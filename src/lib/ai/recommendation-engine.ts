import { generateText, Output } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type { CoachingFeature } from "./feature";
import { createCoachingModel, MODEL_CONFIG } from "./model-config";
import { raceWithRetry } from "./race-with-retry";
import { getLogger } from "../logger";

const coachingLog = getLogger("coaching:reactive");

/**
 * If attempt 1 hasn't completed within this window, a second attempt starts
 * racing alongside it. Sized at ~2-3x normal response latency for gpt-5.4-mini.
 */
const SLOW_ATTEMPT_MS = 10_000;

export interface FeatureCallResult<TOutput> {
  readonly value: TOutput;
  readonly retried: boolean;
}

/**
 * Feature-agnostic engine call. Wraps `generateText` in race-with-retry,
 * threads an abort signal through, and returns the raw schema-typed output
 * alongside the `retried` flag. The caller (session.ask) owns conversation
 * history and feature-specific post-processing.
 */
export async function runFeatureCall<TInput, TOutput>(params: {
  feature: CoachingFeature<TInput, TOutput>;
  system: string;
  messages: readonly ModelMessage[];
  apiKey: string;
  signal?: AbortSignal;
  /**
   * Optional model override. When omitted, uses `createCoachingModel(apiKey)`
   * — the production path. The eval harness injects an OpenRouter-backed
   * model so multi-candidate evaluation reuses this exact code path.
   */
  model?: LanguageModel;
}): Promise<FeatureCallResult<TOutput>> {
  const {
    feature,
    system,
    messages,
    apiKey,
    signal,
    model: modelOverride,
  } = params;

  coachingLog.info(
    `[${feature.id}] Request: ${messages.length} messages in thread`,
    { model: MODEL_CONFIG.id }
  );

  const model = modelOverride ?? createCoachingModel(apiKey);

  const { value, winningAttempt } = await raceWithRetry<TOutput>(
    async ({ attempt, signal: attemptSignal }) => {
      const startMs = Date.now();
      const result = await generateText({
        model,
        system,
        messages: [...messages],
        output: Output.object({ schema: feature.outputSchema }),
        maxOutputTokens: 1024,
        abortSignal: attemptSignal,
      });

      const elapsedMs = Date.now() - startMs;
      const usage = result.usage;

      coachingLog.info(
        `[${feature.id}] Response (${elapsedMs}ms${attempt > 1 ? `, attempt ${attempt}` : ""}): ${usage.inputTokens ?? "?"}in/${usage.outputTokens ?? "?"}out`
      );

      return result.output as TOutput;
    },
    {
      signal,
      slowAfterMs: SLOW_ATTEMPT_MS,
      onRetryTrigger: (reason, err) => {
        const trigger =
          reason === "timeout"
            ? `Attempt 1 exceeded ${SLOW_ATTEMPT_MS}ms`
            : `Attempt 1 failed: ${err instanceof Error ? err.message : String(err)}`;
        coachingLog.warn(
          `[${feature.id}] [RETRY-TRIGGER] ${trigger} — racing a second attempt`
        );
      },
      onRetrySuccess: () => {
        coachingLog.info(
          `[${feature.id}] [RETRY-SUCCESS] Attempt 2 won the race`
        );
      },
      onBothFailed: (lastError) => {
        coachingLog.error(`[${feature.id}] Request failed on both attempts`, {
          error:
            lastError instanceof Error ? lastError.message : String(lastError),
        });
      },
    }
  );

  return { value, retried: winningAttempt > 1 };
}
