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
import { buildSystemPrompt } from "./prompts";
import { scoreItemAwareness } from "./scorers/item-awareness";
import { scoreAugmentRerollAccuracy } from "./scorers/augment-reroll-accuracy";
import { scoreBrevity, scoreDecisiveness } from "./scorers/response-format";
import { scoreConversationalContinuity } from "./scorers/conversational-continuity";

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
  expectedReferences?: string[];
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

const gameFixtures: CoachingFixture[] = JSON.parse(
  readFileSync(
    resolve("fixtures/coaching-sessions/2026-03-26-warwick-aram-mayhem.json"),
    "utf-8"
  )
);

const continuityFixtures: CoachingFixture[] = JSON.parse(
  readFileSync(
    resolve("fixtures/coaching-sessions/continuity-tests.json"),
    "utf-8"
  )
);

// Filter game fixtures to valid responses (skip errors and noise)
const fixtures = [
  ...gameFixtures.filter(
    (f) => f.response !== null && f.error === null && f.question.length > 5
  ),
  ...continuityFixtures,
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

// --- Gate Scorers ---

const itemAwareness = createScorer<EvalInput, EvalOutput>({
  name: "Item Awareness",
  description:
    "Checks that the model does not recommend items the player already owns",
  scorer: ({ input, output }) => {
    return scoreItemAwareness(output.answer, input.fixture.gameState.items);
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
    const history = extractHistory(input.fixture.userPrompt);
    return scoreAugmentRerollAccuracy(
      output.answer,
      input.fixture.question,
      history
    );
  },
});

// --- Ranking Scorers ---

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
      input.fixture.expectedReferences
    );
  },
});

const GATE_SCORERS = [itemAwareness, structuredOutput, augmentRerollAccuracy];
const RANKING_SCORERS = [brevity, decisiveness, conversationalContinuity];
const ALL_SCORERS = [...GATE_SCORERS, ...RANKING_SCORERS];

// --- Helpers ---

/** Extract conversation history from the user prompt's Recent Conversation section */
function extractHistory(
  userPrompt: string
): Array<{ question: string; answer: string }> {
  const history: Array<{ question: string; answer: string }> = [];
  const lines = userPrompt.split("\n");
  let i = 0;

  // Find the Recent Conversation section
  while (i < lines.length && !lines[i].includes("## Recent Conversation")) {
    i++;
  }
  i++; // skip the header

  while (i < lines.length && !lines[i].startsWith("## ")) {
    const playerMatch = lines[i].match(/^\*\*Player:\*\*\s*(.+)/);
    if (playerMatch) {
      const question = playerMatch[1];
      i++;
      const coachMatch = lines[i]?.match(/^\*\*Coach:\*\*\s*(.+)/);
      if (coachMatch) {
        history.push({ question, answer: coachMatch[1] });
      }
    }
    i++;
  }

  return history;
}

/**
 * Apply current prompt optimizations to a captured (old-format) user prompt:
 * - Remove the Current Items section from its original position
 * - Cap conversation history to last 4 exchanges, use Q:/A: format
 * - Append item names directly next to the question
 * - Condense game mode/time and champion lines
 */
function optimizeCapturedPrompt(input: EvalInput): string {
  let prompt = input.userPrompt;
  const items = input.fixture.gameState.items;

  // Extract and remove the Current Items section
  prompt = prompt.replace(/### Current Items[^\n]*\n(?:- [^\n]*\n?)*/, "");

  // Condense game mode + time into one line
  prompt = prompt.replace(
    /## Game Mode: ([^\n]+)\n\n## Game Time: ([^\n]+)/,
    "Game Mode: $1 | Game Time: $2"
  );

  // Condense champion + stat profile
  prompt = prompt.replace(
    /## Your Champion: ([^\n]+)\n\n### Stat Profile\n([^\n]+)/,
    "Champion: $1 | $2"
  );

  // Cap history to last 4 and use Q:/A: format
  const historyMatch = prompt.match(
    /## Recent Conversation\n\n([\s\S]*?)(?=\n\n## )/
  );
  if (historyMatch) {
    const exchanges: Array<{ q: string; a: string }> = [];
    const lines = historyMatch[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const pm = lines[i].match(/^\*\*Player:\*\*\s*(.+)/);
      if (pm) {
        const cm = lines[i + 1]?.match(/^\*\*Coach:\*\*\s*(.+)/);
        if (cm) {
          exchanges.push({ q: pm[1], a: cm[1] });
          i++;
        }
      }
    }
    const recent = exchanges.slice(-4);
    const newHistory = recent.map((e) => `Q: ${e.q}\nA: ${e.a}`).join("\n\n");
    prompt = prompt.replace(
      /## Recent Conversation\n\n[\s\S]*?(?=\n\n## )/,
      `## Recent Conversation\n\n${newHistory}`
    );
  }

  // Move item names to be right next to the question
  if (items.length > 0) {
    const itemList = items.join(", ");
    prompt = prompt.replace(
      /## Question\n(.+)/,
      `## Question\nItems you own: ${itemList}\n$1`
    );
  }

  return prompt;
}

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
      const hasAugmentOptions = input.userPrompt.includes(
        "## Augment Options Being Offered"
      );
      const systemPrompt = buildSystemPrompt({
        gameMode: "KIWI",
        lcuGameMode: "KIWI",
        hasAugmentOptions,
      });

      // Apply current prompt optimizations to captured user prompt
      const userPrompt = optimizeCapturedPrompt(input);

      const result = await generateText({
        model: getModel(model),
        system: systemPrompt,
        prompt: userPrompt,
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
