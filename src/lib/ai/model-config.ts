import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

const useOpenRouter = !!import.meta.env.VITE_OPENROUTER_API_KEY;

export const MODEL_CONFIG = {
  id: useOpenRouter ? "openai/gpt-5.4-mini" : "gpt-5.4-mini",
  name: "GPT-5.4 Mini",
  provider: useOpenRouter ? "openrouter" : "openai",
} as const;

let cachedModel: LanguageModel | null = null;
let cachedApiKey: string | null = null;

export function createCoachingModel(apiKey: string): LanguageModel {
  if (cachedModel && cachedApiKey === apiKey) return cachedModel;

  if (useOpenRouter) {
    const openrouter = createOpenRouter({ apiKey });
    cachedModel = openrouter.chat(MODEL_CONFIG.id);
  } else {
    cachedModel = createOpenAI({ apiKey })(MODEL_CONFIG.id);
  }

  cachedApiKey = apiKey;
  return cachedModel;
}
