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
import { generateText, Output, type ModelMessage } from "ai";
import { readFileSync, existsSync } from "fs";
import { coachingResponseSchema } from "./schemas";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildGameSystemPrompt,
} from "./prompts";
import { formatStateSnapshot, takeGameSnapshot } from "./state-formatter";
import { createConversationSession } from "./conversation-session";
import { computeEnemyStats } from "./enemy-stats";
import { aramMayhemMode, aramMode, classicMode } from "../mode";
import type { GameMode } from "../mode/types";
import type { CoachingContext, CoachingQuery } from "./types";
import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { LiveGameState } from "../reactive/types";
import { scoreItemAwareness } from "./scorers/item-awareness";
import { scoreAugmentRerollAccuracy } from "./scorers/augment-reroll-accuracy";
import { scoreBrevity, scoreDecisiveness } from "./scorers/response-format";
import { scoreConversationalContinuity } from "./scorers/conversational-continuity";
import { scoreGoldAwareness } from "./scorers/gold-awareness";
import { scoreUnnecessaryWarnings } from "./scorers/unnecessary-warnings";

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
  category?: "common" | "mayhem" | "sr" | "arena";
}

interface EvalInput {
  label: string;
  category: string;
  question: string;
  champion: string;
  gameTime: string;
  items: string[];
  gold: number;
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

// Load all game fixture files (coaching-*.json) and the continuity tests
import { readdirSync } from "fs";

const fixturesDir = resolve("fixtures/coaching-sessions");
const gameFixtureFiles = readdirSync(fixturesDir).filter((f) =>
  f.endsWith(".json")
);

const gameFixtures: GameFixture[] = gameFixtureFiles.flatMap((file) =>
  JSON.parse(readFileSync(resolve(fixturesDir, file), "utf-8"))
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

  const mins = Math.floor(f.context.gameTime / 60);
  const secs = f.context.gameTime % 60;

  return {
    label: f.label,
    category: f.category ?? "common",
    question: f.query.question,
    champion: f.context.champion.name,
    gameTime: `${mins}:${String(secs).padStart(2, "0")}`,
    items: f.context.currentItems.map((i) => i.name),
    gold: f.context.currentGold,
    systemPrompt,
    userPrompt,
    history: f.query.history ?? [],
    expectedReferences: f.expectedReferences,
  };
}

// Filter out errors and noise, but keep synthetic fixtures (response === null is OK)
const validGameInputs = gameFixtures
  .filter((f) => f.error === null && f.query.question.length > 5)
  .map(gameFixtureToInput);

// Categorize using the fixture's category field
const CATEGORY_LABELS: Record<string, string> = {
  common: "Common",
  mayhem: "Mayhem",
  sr: "SR",
  arena: "Arena",
};

const inputsByCategory = new Map<string, EvalInput[]>();
for (const input of validGameInputs) {
  const category = CATEGORY_LABELS[input.category] ?? "Common";
  const list = inputsByCategory.get(category) ?? [];
  list.push(input);
  inputsByCategory.set(category, list);
}

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
  { name: "GPT 5.4 mini", id: "gpt-5.4-mini", provider: "openai" },
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

const goldAwareness = createScorer<EvalInput, EvalOutput>({
  name: "Gold Awareness",
  description:
    "Checks that the model uses exact gold amount instead of hedging",
  scorer: ({ input, output }) => {
    return scoreGoldAwareness(output.answer, input.gold, input.question);
  },
});

const unnecessaryWarnings = createScorer<EvalInput, EvalOutput>({
  name: "Unnecessary Warnings",
  description:
    "Checks that the model doesn't warn about not re-buying owned items unprompted",
  scorer: ({ input, output }) => {
    return scoreUnnecessaryWarnings(output.answer, input.question);
  },
});

const GATE_SCORERS = [itemAwareness, structuredOutput, augmentRerollAccuracy];
const RANKING_SCORERS = [
  brevity,
  decisiveness,
  conversationalContinuity,
  goldAwareness,
  unnecessaryWarnings,
];
const ALL_SCORERS = [...GATE_SCORERS, ...RANKING_SCORERS];

// --- Register single-turn evals ---

for (const model of models) {
  for (const [category, inputs] of inputsByCategory) {
    if (inputs.length === 0) continue;

    evalite(`${model.name} / ${category}`, {
      data: () => inputs.map((input) => ({ input })),

      task: async (input: EvalInput): Promise<EvalOutput> => {
        const result = await generateText({
          model: getModel(model),
          system: input.systemPrompt,
          prompt: input.userPrompt,
          output: Output.object({ schema: coachingResponseSchema }),
          maxOutputTokens: 4096,
        });

        return result.output;
      },

      scorers: ALL_SCORERS,

      columns: (result) => [
        { label: "Category", value: category },
        {
          label: "Champion",
          value: `${result.input.champion} @${result.input.gameTime}`,
        },
        {
          label: "Question",
          value: result.input.question.substring(0, 45),
        },
        {
          label: "Context",
          value: `${result.input.items.length} items, ${result.input.gold}g`,
        },
      ],
    });
  }
}

// --- Multi-turn eval types and registration ---

interface MultiTurnFixture {
  label: string;
  index: number;
  timestamp: string;
  model: string;
  category: string;
  gameState: GameState;
  gameModeId: "aram-mayhem" | "aram" | "classic";
  chosenAugments: string[];
  query: {
    question: string;
    history?: Array<{ question: string; answer: string }>;
    augmentOptions?: Array<{
      name: string;
      description: string;
      tier: string;
      sets?: string[];
    }>;
  };
  response: {
    answer: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  } | null;
  error: string | null;
  expectedReferences?: string[];
  scorerContext: {
    items: string[];
    gold: number;
    champion: string;
    gameTime: string;
  };
}

interface MultiTurnEvalInput extends EvalInput {
  messages: ModelMessage[];
}

const MODE_MAP: Record<string, GameMode> = {
  "aram-mayhem": aramMayhemMode,
  aram: aramMode,
  classic: classicMode,
};

const multiTurnFixturesDir = resolve("fixtures/coaching-sessions-v2");

if (existsSync(multiTurnFixturesDir)) {
  const { loadGameData } = await import("../data-ingest");
  const gameData = await loadGameData();

  const mtFixtureFiles = readdirSync(multiTurnFixturesDir).filter((f) =>
    f.endsWith(".json")
  );
  const mtFixtures: MultiTurnFixture[] = mtFixtureFiles.flatMap((file) =>
    JSON.parse(readFileSync(resolve(multiTurnFixturesDir, file), "utf-8"))
  );

  const validMtFixtures = mtFixtures.filter(
    (f) => f.error === null && f.query.question.length > 5
  );

  function buildMultiTurnInput(
    f: MultiTurnFixture,
    gameData: LoadedGameData
  ): MultiTurnEvalInput {
    const mode = MODE_MAP[f.gameModeId];
    if (!mode) {
      throw new Error(`Unknown gameModeId: ${f.gameModeId}`);
    }

    // Build the system prompt using real function
    const systemPrompt = buildGameSystemPrompt(mode, gameData, f.gameState);

    // Compute enemy stats for each enemy player
    const activePlayerInfo = f.gameState.players.find((p) => p.isActivePlayer);
    const activeTeam = activePlayerInfo?.team ?? "ORDER";
    const enemyPlayers = f.gameState.players.filter(
      (p) => p.team !== activeTeam
    );

    const enemyStats = new Map<string, ReturnType<typeof computeEnemyStats>>();
    for (const enemy of enemyPlayers) {
      const champData = gameData.champions.get(
        enemy.championName.toLowerCase()
      );
      if (champData) {
        const enemyItems = enemy.items
          .map((item) => gameData.items.get(item.id))
          .filter((item): item is NonNullable<typeof item> => item != null);
        enemyStats.set(
          enemy.championName,
          computeEnemyStats(champData.stats, enemy.level, enemyItems)
        );
      }
    }

    // Build LiveGameState from GameState
    const liveGameState: LiveGameState = {
      activePlayer: f.gameState.activePlayer,
      players: f.gameState.players,
      gameMode: f.gameState.gameMode,
      lcuGameMode:
        f.gameModeId === "aram-mayhem" ? "KIWI" : f.gameState.gameMode,
      gameTime: f.gameState.gameTime,
      champSelect: null,
      eogStats: null,
    };

    // Build snapshot and format it
    const snapshot = takeGameSnapshot(
      liveGameState,
      enemyStats,
      gameData,
      f.chosenAugments
    );
    const stateText = snapshot ? formatStateSnapshot(snapshot) : "";

    // Build conversation session with history
    const session = createConversationSession(systemPrompt);

    if (f.query.history) {
      for (const exchange of f.query.history) {
        session.addUserMessage(stateText, exchange.question);
        session.addAssistantMessage(exchange.answer);
      }
    }

    // Add current question
    session.addUserMessage(stateText, f.query.question);

    return {
      label: f.label,
      category: f.category,
      question: f.query.question,
      champion: f.scorerContext.champion,
      gameTime: f.scorerContext.gameTime,
      items: f.scorerContext.items,
      gold: f.scorerContext.gold,
      systemPrompt: session.systemPrompt,
      userPrompt: "", // not used in multi-turn — messages carry the content
      history: f.query.history ?? [],
      expectedReferences: f.expectedReferences,
      messages: [...session.messages],
    };
  }

  // Group multi-turn inputs by category
  const mtInputsByCategory = new Map<string, MultiTurnEvalInput[]>();
  for (const f of validMtFixtures) {
    const input = buildMultiTurnInput(f, gameData);
    const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
    const list = mtInputsByCategory.get(categoryLabel) ?? [];
    list.push(input);
    mtInputsByCategory.set(categoryLabel, list);
  }

  // Register multi-turn evals
  for (const model of models) {
    for (const [category, inputs] of mtInputsByCategory) {
      if (inputs.length === 0) continue;

      evalite(`${model.name} / ${category} [multi-turn]`, {
        data: () => inputs.map((input) => ({ input })),

        task: async (input: MultiTurnEvalInput): Promise<EvalOutput> => {
          const result = await generateText({
            model: getModel(model),
            system: input.systemPrompt,
            messages: input.messages as ModelMessage[],
            output: Output.object({ schema: coachingResponseSchema }),
            maxOutputTokens: 4096,
          });

          return result.output;
        },

        scorers: ALL_SCORERS,

        columns: (result) => [
          { label: "Category", value: `${category} [MT]` },
          {
            label: "Champion",
            value: `${result.input.champion} @${result.input.gameTime}`,
          },
          {
            label: "Question",
            value: result.input.question.substring(0, 45),
          },
          {
            label: "Context",
            value: `${result.input.items.length} items, ${result.input.gold}g`,
          },
        ],
      });
    }
  }
} else {
  console.log(
    "Multi-turn fixtures not found at fixtures/coaching-sessions-v2/ — skipping multi-turn evals"
  );
}
