import { createOpenAI } from "@ai-sdk/openai";

export const MODEL_CONFIG = {
  id: "gpt-5.4-mini",
  name: "GPT-5.4 Mini",
  provider: "openai",
} as const;

let cachedModel: ReturnType<ReturnType<typeof createOpenAI>> | null = null;
let cachedApiKey: string | null = null;

export function createCoachingModel(apiKey: string) {
  if (cachedModel && cachedApiKey === apiKey) return cachedModel;
  cachedModel = createOpenAI({ apiKey })(MODEL_CONFIG.id);
  cachedApiKey = apiKey;
  return cachedModel;
}
