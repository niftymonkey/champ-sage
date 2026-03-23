import { generateText, Output } from "ai";
import type { CoachingContext, CoachingQuery, CoachingResponse } from "./types";
import { createCoachingModel, MODEL_CONFIG } from "./model-config";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { coachingResponseSchema } from "./schemas";

export async function getCoachingResponse(
  context: CoachingContext,
  query: CoachingQuery,
  apiKey: string
): Promise<CoachingResponse> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context, query);

  console.log("\n=== COACHING REQUEST ===");
  console.log(`Model: ${MODEL_CONFIG.id}`);
  console.log(`Question: ${query.question}`);
  console.log(`Champion: ${context.champion.name} Lv${context.champion.level}`);
  console.log(`Items: ${context.currentItems.join(", ") || "None"}`);
  console.log(`Augments: ${context.currentAugments.join(", ") || "None"}`);
  console.log(`Mode: ${context.gameMode}`);
  console.log(
    `Enemies: ${context.enemyTeam.map((e) => e.champion).join(", ") || "None"}`
  );
  console.log("\n--- SYSTEM PROMPT ---");
  console.log(systemPrompt);
  console.log("\n--- USER PROMPT ---");
  console.log(userPrompt);
  console.log("\n--- CALLING LLM ---");

  const startMs = Date.now();
  const model = createCoachingModel(apiKey);

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      output: Output.object({ schema: coachingResponseSchema }),
      maxOutputTokens: 1024,
    });

    const elapsedMs = Date.now() - startMs;
    const usage = result.usage;

    console.log(`\n--- RESPONSE (${elapsedMs}ms) ---`);
    console.log(
      `Tokens: ${usage.inputTokens ?? "?"} in / ${usage.outputTokens ?? "?"} out`
    );
    console.log(`Answer: ${result.output.answer}`);
    if (result.output.recommendations.length > 0) {
      console.log("Recommendations:");
      for (const rec of result.output.recommendations) {
        console.log(`  - ${rec.name}: ${rec.reasoning}`);
      }
    }
    console.log("=== END COACHING REQUEST ===\n");

    return result.output;
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    console.error(`\n--- ERROR (${elapsedMs}ms) ---`);
    console.error(err);
    console.error("=== END COACHING REQUEST ===\n");
    throw err;
  }
}
