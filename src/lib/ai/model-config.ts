import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Whether the app is configured to route LLM calls through OpenRouter.
 * Read at function-call time rather than module load so this file is safe
 * to import from any environment (Node, vitest, evalite) — `import.meta.env`
 * is a Vite compile-time shim that's undefined outside the Vite pipeline.
 */
function useOpenRouter(): boolean {
  return !!import.meta.env?.VITE_OPENROUTER_API_KEY;
}

export const MODEL_CONFIG = {
  get id() {
    return useOpenRouter() ? "openai/gpt-5.4-mini" : "gpt-5.4-mini";
  },
  name: "GPT-5.4 Mini",
  get provider() {
    return useOpenRouter() ? "openrouter" : "openai";
  },
} as const;

let cachedModel: LanguageModel | null = null;
let cachedApiKey: string | null = null;

export function createCoachingModel(apiKey: string): LanguageModel {
  if (cachedModel && cachedApiKey === apiKey) return cachedModel;

  if (useOpenRouter()) {
    const openrouter = createOpenRouter({ apiKey });
    cachedModel = openrouter.chat(MODEL_CONFIG.id);
  } else {
    cachedModel = createOpenAI({ apiKey })(MODEL_CONFIG.id);
  }

  cachedApiKey = apiKey;
  return cachedModel;
}
