import { generateText, Output } from "ai";
import { invoke } from "@tauri-apps/api/core";
import type { CoachingContext, CoachingQuery, CoachingResponse } from "./types";
import { createCoachingModel, MODEL_CONFIG } from "./model-config";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { coachingResponseSchema } from "./schemas";

function logToFile(text: string): void {
  const timestamp = new Date().toISOString();
  invoke("append_coaching_log", { text: `[${timestamp}] ${text}` }).catch(
    () => {}
  );
}

export async function getCoachingResponse(
  context: CoachingContext,
  query: CoachingQuery,
  apiKey: string
): Promise<CoachingResponse> {
  const systemPrompt = buildSystemPrompt(context);
  const userPrompt = buildUserPrompt(context, query);

  logToFile(
    [
      "=== COACHING REQUEST ===",
      `Model: ${MODEL_CONFIG.id}`,
      `Question: ${query.question}`,
      `Champion: ${context.champion.name} Lv${context.champion.level}`,
      `Items: ${context.currentItems.map((i) => i.name).join(", ") || "None"}`,
      `Augments: ${context.currentAugments.map((a) => a.name).join(", ") || "None"}`,
      `Mode: ${context.gameMode} (LCU: ${context.lcuGameMode}) | Augments tracked: ${context.currentAugments.length > 0 ? context.currentAugments.map((a) => a.name).join(", ") : "None"}`,
      `Enemies: ${context.enemyTeam.map((e) => e.champion).join(", ") || "None"}`,
      `History: ${query.history?.length ?? 0} exchanges`,
      "",
      "--- SYSTEM PROMPT ---",
      systemPrompt,
      "",
      "--- USER PROMPT ---",
      userPrompt,
    ].join("\n")
  );

  const startMs = Date.now();
  const model = createCoachingModel(apiKey);

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: buildUserPrompt(context, query),
      output: Output.object({ schema: coachingResponseSchema }),
      maxOutputTokens: 1024,
    });

    const elapsedMs = Date.now() - startMs;
    const usage = result.usage;
    const recs = result.output.recommendations;

    logToFile(
      [
        `--- RESPONSE (${elapsedMs}ms) ---`,
        `Tokens: ${usage.inputTokens ?? "?"}in / ${usage.outputTokens ?? "?"}out`,
        `Answer: ${result.output.answer}`,
        ...(recs.length > 0
          ? [
              "Recommendations:",
              ...recs.map((r, i) => `  #${i + 1} ${r.name}: ${r.reasoning}`),
            ]
          : []),
        "=== END COACHING REQUEST ===",
      ].join("\n")
    );

    return result.output;
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    logToFile(
      `--- ERROR (${elapsedMs}ms) ---\n${message}\n=== END COACHING REQUEST ===`
    );
    throw err;
  }
}
