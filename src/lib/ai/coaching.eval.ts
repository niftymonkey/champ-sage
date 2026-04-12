/**
 * Coaching evaluation pipeline.
 *
 * Replays coaching sessions from multi-turn fixtures against model candidates
 * and scores the responses using the same buildGameSystemPrompt function
 * the app uses in production.
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
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, type ModelMessage } from "ai";
import { readFileSync, readdirSync } from "fs";
import { coachingResponseSchema } from "./schemas";
import { buildGameSystemPrompt } from "./prompts";
import { formatStateSnapshot, takeGameSnapshot } from "./state-formatter";
import { createConversationSession } from "./conversation-session";
import { computeEnemyStats } from "./enemy-stats";
import { aramMayhemMode, aramMode, classicMode } from "../mode";
import type { GameMode } from "../mode/types";
import type { GameState } from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";
import type { LiveGameState } from "../reactive/types";
import { scoreItemAwareness } from "./scorers/item-awareness";
import { scoreAugmentRerollAccuracy } from "./scorers/augment-reroll-accuracy";
import { scoreBrevity, scoreDecisiveness } from "./scorers/response-format";
import { scoreConversationalContinuity } from "./scorers/conversational-continuity";
import { scoreGoldAwareness } from "./scorers/gold-awareness";
import { scoreUnnecessaryWarnings } from "./scorers/unnecessary-warnings";
import { scoreStateAwareness } from "./scorers/state-awareness";
import { scorePivotExplanation } from "./scorers/pivot-explanation";
import { scoreGoldAwareRecommendations } from "./scorers/gold-aware-recommendations";

// --- Types ---

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
  scorerHints?: ScorerHints;
  enemyChampions: string[];
}

interface ScorerHints {
  stateAwareness?: Array<
    "grievous-wounds" | "mr-needed" | "enemy-comp" | "existing-items"
  >;
  pivotExpected?: boolean;
  priorRecommendation?: string;
  goldAware?: boolean;
}

interface EvalOutput {
  answer: string;
  recommendations: Array<{ name: string; reasoning: string }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  common: "Common",
  mayhem: "Mayhem",
  sr: "SR",
  arena: "Arena",
};

// --- Model setup ---
//
// Evals always use OpenRouter via EVAL_OPENROUTER_API_KEY. This keeps eval
// costs separate from the app's VITE_OPENAI_API_KEY.

const openrouterKey = process.env.EVAL_OPENROUTER_API_KEY;

if (!openrouterKey) {
  throw new Error("EVAL_OPENROUTER_API_KEY required in .env for evalite runs");
}

const openrouter = createOpenRouter({ apiKey: openrouterKey });

interface ModelCandidate {
  name: string;
  id: string;
}

// Models to evaluate. Comment/uncomment to control which models run.
const models: ModelCandidate[] = [
  { name: "GPT 5.4 mini", id: "openai/gpt-5.4-mini" },
  // { name: "GPT 5.4", id: "openai/gpt-5.4" },
  // { name: "Gemini 2.5 Pro", id: "google/gemini-2.5-pro" },
  // { name: "Claude Sonnet 4.6", id: "anthropic/claude-sonnet-4.6" },
];

function getModel(candidate: ModelCandidate) {
  return openrouter.chat(candidate.id);
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

const stateAwareness = createScorer<EvalInput, EvalOutput>({
  name: "State Awareness",
  description:
    "Checks that the model references relevant game state (enemy comp, items, resistances)",
  scorer: ({ input, output }) => {
    return scoreStateAwareness(
      output.answer,
      input.scorerHints?.stateAwareness,
      input.items,
      input.enemyChampions
    );
  },
});

const pivotExplanation = createScorer<EvalInput, EvalOutput>({
  name: "Pivot Explanation",
  description:
    "Checks that recommendation changes from prior turns are explained",
  scorer: ({ input, output }) => {
    return scorePivotExplanation(
      output.answer,
      input.scorerHints?.pivotExpected,
      input.scorerHints?.priorRecommendation,
      input.history
    );
  },
});

const goldAwareRecommendations = createScorer<EvalInput, EvalOutput>({
  name: "Gold-Aware Recommendations",
  description:
    "Checks that item recommendations follow the destination + component format",
  scorer: ({ input, output }) => {
    return scoreGoldAwareRecommendations(
      output.answer,
      input.gold,
      input.question
    );
  },
});

const GATE_SCORERS = [
  itemAwareness,
  structuredOutput,
  augmentRerollAccuracy,
  stateAwareness,
  goldAwareRecommendations,
];
const RANKING_SCORERS = [
  brevity,
  decisiveness,
  conversationalContinuity,
  goldAwareness,
  unnecessaryWarnings,
  pivotExplanation,
];
const ALL_SCORERS = [...GATE_SCORERS, ...RANKING_SCORERS];

// --- Multi-turn fixture types ---

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
  scorerHints?: ScorerHints;
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

// --- Load fixtures and register evals ---

const fixturesDir = resolve("fixtures/coaching-sessions-v2");
const { loadGameData } = await import("../data-ingest");
const gameData = await loadGameData();

const fixtureFiles = readdirSync(fixturesDir).filter((f) =>
  f.endsWith(".json")
);
const fixtures: MultiTurnFixture[] = fixtureFiles.flatMap((file) =>
  JSON.parse(readFileSync(resolve(fixturesDir, file), "utf-8"))
);

const validFixtures = fixtures.filter(
  (f) => f.error === null && f.query.question.length > 5
);

function buildEvalInput(
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
  const enemyPlayers = f.gameState.players.filter((p) => p.team !== activeTeam);

  const enemyStats = new Map<string, ReturnType<typeof computeEnemyStats>>();
  for (const enemy of enemyPlayers) {
    const champData = gameData.champions.get(enemy.championName.toLowerCase());
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
    lcuGameMode: f.gameModeId === "aram-mayhem" ? "KIWI" : f.gameState.gameMode,
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
    userPrompt: "", // not used — messages carry the content
    history: f.query.history ?? [],
    expectedReferences: f.expectedReferences,
    scorerHints: f.scorerHints,
    enemyChampions: enemyPlayers.map((p) => p.championName),
    messages: [...session.messages],
  };
}

// Group inputs by category
const inputsByCategory = new Map<string, MultiTurnEvalInput[]>();
for (const f of validFixtures) {
  const input = buildEvalInput(f, gameData);
  const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
  const list = inputsByCategory.get(categoryLabel) ?? [];
  list.push(input);
  inputsByCategory.set(categoryLabel, list);
}

// Register evals
for (const model of models) {
  for (const [category, inputs] of inputsByCategory) {
    if (inputs.length === 0) continue;

    evalite(`${model.name} / ${category}`, {
      data: () => inputs.map((input) => ({ input })),

      task: async (input: MultiTurnEvalInput): Promise<EvalOutput> => {
        const result = await generateText({
          model: getModel(model),
          system: input.systemPrompt,
          messages: input.messages,
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
