/**
 * Coaching evaluation pipeline.
 *
 * Replays real coaching prompts from game sessions against model candidates
 * and scores the responses using the same buildSystemPrompt/buildUserPrompt
 * functions the app uses in production.
 *
 * Usage:
 *   npx evalite src/lib/ai/coaching.eval.ts
 *   npx evalite watch src/lib/ai/coaching.eval.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env"), override: true });

import { evalite } from "evalite";
import { createScorer } from "evalite";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { readFileSync } from "fs";
import { coachingResponseSchema } from "./schemas";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import type { CoachingContext, CoachingQuery } from "./types";
import { scoreItemAwareness } from "./scorers/item-awareness";
import { scoreAugmentRerollAccuracy } from "./scorers/augment-reroll-accuracy";
import { scoreBrevity, scoreDecisiveness } from "./scorers/response-format";
import { scoreConversationalContinuity } from "./scorers/conversational-continuity";

// --- Types ---

interface GameFixture {
  label: string;
  index: number;
  timestamp: string;
  model: string;
  context: CoachingContext;
  query: CoachingQuery;
  response: {
    answer: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  } | null;
  error: string | null;
  expectedReferences?: string[];
}

// Continuity fixtures use a simpler format with pre-baked prompts
interface ContinuityFixture {
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
  response: null;
  error: null;
  expectedReferences?: string[];
}

interface EvalInput {
  label: string;
  question: string;
  items: string[];
  systemPrompt: string;
  userPrompt: string;
  history: Array<{ question: string; answer: string }>;
  expectedReferences?: string[];
}

interface EvalOutput {
  answer: string;
  recommendations: Array<{ name: string; reasoning: string }>;
}

// --- Load fixtures ---

const gameFixtures: GameFixture[] = JSON.parse(
  readFileSync(
    resolve("fixtures/coaching-sessions/2026-03-26-warwick-aram-mayhem.json"),
    "utf-8"
  )
);

const continuityFixtures: ContinuityFixture[] = JSON.parse(
  readFileSync(
    resolve("fixtures/coaching-sessions/continuity-tests.json"),
    "utf-8"
  )
);

// Build eval inputs from game fixtures using real app functions
function gameFixtureToInput(f: GameFixture): EvalInput {
  const hasAugmentOptions =
    f.query.augmentOptions != null && f.query.augmentOptions.length > 0;
  const systemPrompt = buildSystemPrompt({
    gameMode: f.context.gameMode,
    lcuGameMode: f.context.lcuGameMode,
    hasAugmentOptions,
  });
  const userPrompt = buildUserPrompt(f.context, f.query);

  return {
    label: f.label,
    question: f.query.question,
    items: f.context.currentItems.map((i) => i.name),
    systemPrompt,
    userPrompt,
    history: f.query.history ?? [],
    expectedReferences: f.expectedReferences,
  };
}

// Build eval inputs from continuity fixtures (pre-baked prompts)
function continuityFixtureToInput(f: ContinuityFixture): EvalInput {
  const hasAugmentOptions = f.userPrompt.includes(
    "## Augment Options Being Offered"
  );
  const systemPrompt = buildSystemPrompt({
    gameMode: "KIWI",
    lcuGameMode: "KIWI",
    hasAugmentOptions,
  });

  return {
    label: f.label,
    question: f.question,
    items: f.gameState.items,
    systemPrompt,
    userPrompt: f.userPrompt,
    history: [],
    expectedReferences: f.expectedReferences,
  };
}

// Filter game fixtures to valid responses (skip errors and noise)
const evalInputs: EvalInput[] = [
  ...gameFixtures
    .filter(
      (f) =>
        f.response !== null && f.error === null && f.query.question.length > 5
    )
    .map(gameFixtureToInput),
  ...continuityFixtures.map(continuityFixtureToInput),
];

// --- Model setup ---

const openaiKey = process.env.VITE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
const openrouterKey = process.env.OPENROUTER_API_KEY;

if (!openaiKey && !openrouterKey) {
  throw new Error(
    "At least one API key required in .env: VITE_OPENAI_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY"
  );
}

const openai = openaiKey ? createOpenAI({ apiKey: openaiKey }) : null;
const openrouter = openrouterKey
  ? createOpenAI({
      apiKey: openrouterKey,
      baseURL: "https://openrouter.ai/api/v1",
    })
  : null;

interface ModelCandidate {
  name: string;
  id: string;
  provider: "openai" | "openrouter";
}

// Models to evaluate across providers and tiers.
// Comment/uncomment to control which models run.
const models: ModelCandidate[] = [
  { name: "GPT 5.4 mini", id: "openai/gpt-5.4-mini", provider: "openrouter" },
  // { name: "GPT 5.4", id: "openai/gpt-5.4", provider: "openrouter" },
  // { name: "Gemini 2.5 Pro", id: "google/gemini-2.5-pro", provider: "openrouter" },
  // { name: "Claude Sonnet 4.6", id: "anthropic/claude-sonnet-4.6", provider: "openrouter" },
];

function getModel(candidate: ModelCandidate) {
  if (candidate.provider === "openai") {
    if (!openai) throw new Error(`OpenAI key required for ${candidate.name}`);
    return openai(candidate.id);
  }
  if (!openrouter)
    throw new Error(`OpenRouter key required for ${candidate.name}`);
  return openrouter(candidate.id);
}

// --- Scorers ---

const itemAwareness = createScorer<EvalInput, EvalOutput>({
  name: "Item Awareness",
  description:
    "Checks that the model does not recommend items the player already owns",
  scorer: ({ input, output }) => {
    return scoreItemAwareness(output.answer, input.items);
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

const augmentRerollAccuracy = createScorer<EvalInput, EvalOutput>({
  name: "Augment Re-Roll Accuracy",
  description:
    "Checks that the model follows actual re-roll mechanics when advising on augments",
  scorer: ({ input, output }) => {
    return scoreAugmentRerollAccuracy(
      output.answer,
      input.question,
      input.history
    );
  },
});

const brevity = createScorer<EvalInput, EvalOutput>({
  name: "Brevity",
  description: "Checks that responses are concise",
  scorer: ({ output }) => {
    return scoreBrevity(output.answer);
  },
});

const decisiveness = createScorer<EvalInput, EvalOutput>({
  name: "Decisiveness",
  description:
    "Checks that responses give a clear recommendation without hedging",
  scorer: ({ output }) => {
    return scoreDecisiveness(output.answer);
  },
});

const conversationalContinuity = createScorer<EvalInput, EvalOutput>({
  name: "Conversational Continuity",
  description:
    "Checks that the model can resolve references to earlier conversation",
  scorer: ({ input, output }) => {
    return scoreConversationalContinuity(
      output.answer,
      input.expectedReferences
    );
  },
});

const GATE_SCORERS = [itemAwareness, structuredOutput, augmentRerollAccuracy];
const RANKING_SCORERS = [brevity, decisiveness, conversationalContinuity];
const ALL_SCORERS = [...GATE_SCORERS, ...RANKING_SCORERS];

// --- Register evals ---

for (const model of models) {
  evalite(`Coaching / ${model.name}`, {
    data: () => evalInputs.map((input) => ({ input })),

    task: async (input: EvalInput): Promise<EvalOutput> => {
      const result = await generateText({
        model: getModel(model),
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
        value: result.input.question.substring(0, 50),
      },
      {
        label: "Items",
        value: String(result.input.items.length),
      },
    ],
  });
}
