/**
 * Coaching evaluation pipeline.
 *
 * Replays real coaching prompts from game sessions against model candidates
 * and scores the responses for context awareness, recommendation quality,
 * and response format.
 *
 * Usage:
 *   npx evalite src/lib/ai/coaching.eval.ts
 *   npx evalite watch src/lib/ai/coaching.eval.ts
 */

import { evalite } from "evalite";
import { createScorer } from "evalite";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { readFileSync } from "fs";
import { resolve } from "path";
import { coachingResponseSchema } from "./schemas";
import { scoreItemAwareness } from "./scorers/item-awareness";

// --- Types ---

interface CoachingFixture {
  label: string;
  index: number;
  timestamp: string;
  model: string;
  question: string;
  systemPrompt: string;
  userPrompt: string;
  gameState: {
    champion: string;
    level: number;
    items: string[];
    augments: string[];
    enemies: string[];
    gold: number;
    gameTime: string;
    kda: string;
  };
  response: {
    answer: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  } | null;
  error: string | null;
}

interface EvalInput {
  fixture: CoachingFixture;
  systemPrompt: string;
  userPrompt: string;
}

interface EvalOutput {
  answer: string;
  recommendations: Array<{ name: string; reasoning: string }>;
}

// --- Load fixtures ---

const fixturesPath = resolve(
  "fixtures/coaching-sessions/2026-03-26-warwick-aram-mayhem.json"
);
const allFixtures: CoachingFixture[] = JSON.parse(
  readFileSync(fixturesPath, "utf-8")
);

// Filter to fixtures that got valid responses (skip errors and noise)
const fixtures = allFixtures.filter(
  (f) => f.response !== null && f.error === null && f.question.length > 5 // Skip truncated transcripts like "Witt..." and "I choose..."
);

// --- Model setup ---

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY required in .env");
}

const openai = createOpenAI({ apiKey });

// Models to evaluate. Start with the current model; add candidates later.
const models = [{ name: "gpt-5.4-mini", id: "gpt-5.4-mini" }];

// --- Scorers ---

const itemAwareness = createScorer<EvalInput, EvalOutput>({
  name: "Item Awareness",
  description:
    "Checks that the model does not recommend items the player already owns",
  scorer: ({ input, output }) => {
    return scoreItemAwareness(output.answer, input.fixture.gameState.items);
  },
});

const responseLength = createScorer<EvalInput, EvalOutput>({
  name: "Response Length",
  description:
    "Checks that responses are concise (under 3 sentences for simple questions)",
  scorer: ({ output }) => {
    const sentences = output.answer.split(/[.!?]+/).filter((s) => s.trim());
    // Allow up to 4 sentences; degrade linearly after that
    if (sentences.length <= 4) return 1;
    if (sentences.length <= 6) return 0.5;
    return 0;
  },
});

const structuredOutput = createScorer<EvalInput, EvalOutput>({
  name: "Structured Output",
  description: "Checks that the model produced valid structured output",
  scorer: ({ output }) => {
    if (!output.answer) return 0;
    if (!Array.isArray(output.recommendations)) return 0;
    return 1;
  },
});

const GATE_SCORERS = [itemAwareness, structuredOutput];
const RANKING_SCORERS = [responseLength];
const ALL_SCORERS = [...GATE_SCORERS, ...RANKING_SCORERS];

// --- Register evals ---

for (const model of models) {
  evalite(`Coaching / ${model.name}`, {
    data: () =>
      fixtures.map((fixture) => ({
        input: {
          fixture,
          systemPrompt: fixture.systemPrompt,
          userPrompt: fixture.userPrompt,
        },
      })),

    task: async (input: EvalInput): Promise<EvalOutput> => {
      const result = await generateText({
        model: openai(model.id),
        system: input.systemPrompt,
        prompt: input.userPrompt,
        output: Output.object({ schema: coachingResponseSchema }),
        maxOutputTokens: 1024,
      });

      return result.output;
    },

    scorers: ALL_SCORERS,

    columns: (result) => [
      {
        label: "Question",
        value: result.input.fixture.question.substring(0, 50),
      },
      { label: "Champion", value: result.input.fixture.gameState.champion },
      {
        label: "Items",
        value: String(result.input.fixture.gameState.items.length),
      },
      { label: "Time", value: result.input.fixture.gameState.gameTime },
    ],
  });
}
