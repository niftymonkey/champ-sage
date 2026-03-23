import { createOpenAI } from "@ai-sdk/openai";

export const MODEL_CONFIG = {
  id: "gpt-5.4-mini",
  name: "GPT-5.4 Mini",
  provider: "openai",
} as const;

export function createCoachingModel(apiKey: string) {
  return createOpenAI({ apiKey })(MODEL_CONFIG.id);
}
