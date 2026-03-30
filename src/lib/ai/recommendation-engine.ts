import { generateText, Output } from "ai";
import type { CoachingContext, CoachingQuery, CoachingResponse } from "./types";
import { createCoachingModel, MODEL_CONFIG } from "./model-config";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { coachingResponseSchema } from "./schemas";
import { getLogger } from "../logger";

const coachingLog = getLogger("coaching:reactive");

export async function getCoachingResponse(
  context: CoachingContext,
  query: CoachingQuery,
  apiKey: string,
  options?: { signal?: AbortSignal }
): Promise<CoachingResponse> {
  const systemPrompt = buildSystemPrompt({
    ...context,
    hasAugmentOptions:
      query.augmentOptions != null && query.augmentOptions.length > 0,
  });
  const userPrompt = buildUserPrompt(context, query);

  coachingLog.info(
    `Request: ${query.question} | ${context.champion.name} Lv${context.champion.level} | ${context.gameMode}`,
    {
      model: MODEL_CONFIG.id,
      items: context.currentItems.map((i) => i.name),
      augments: context.currentAugments.map((a) => a.name),
      enemies: context.enemyTeam.map((e) => e.champion),
      historyLength: query.history?.length ?? 0,
    }
  );

  coachingLog.trace("System prompt:", systemPrompt);
  coachingLog.trace("User prompt:", userPrompt);

  const startMs = Date.now();
  const model = createCoachingModel(apiKey);

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
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

    coachingLog.trace("Full response:", result.output);

    return result.output;
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    coachingLog.error("Request failed", {
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
