/**
 * Coaching evaluation pipeline.
 *
 * Replays coaching sessions from multi-turn fixtures through the production
 * code path. The harness builds a MatchSession with an injected
 * OpenRouter model, pre-loads history as prose, then invokes
 * `session.ask(feature, input)` for the test turn. The model provider is
 * the only eval-specific knob — everything else (base context, feature
 * selection, per-feature schemas/prompts, history accumulation, retry
 * behavior) reuses the same code the app runs in production.
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

import { evalite, createScorer } from "evalite";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { readFileSync, readdirSync } from "fs";
import { buildBaseContext } from "./base-context";
import {
  formatStateSnapshot,
  takeGameSnapshot,
  type GameSnapshot,
} from "./state-formatter";
import { createMatchSession } from "./match-session";
import { computeEnemyStats } from "./enemy-stats";
import { aramMayhemMode, aramMode, classicMode } from "../mode";
import type { GameMode } from "../mode/types";
import type { GameState } from "../game-state/types";
import type { LiveGameState } from "../reactive/types";
import type { BuildPathItem } from "./types";
import {
  augmentFitFeature,
  type AugmentFitInput,
  type AugmentFitResult,
} from "./features/augment-fit";
import {
  createGamePlanFeature,
  findDuplicateBoots,
  isUpdatePlanCommand,
  type GamePlanInput,
  type GamePlanResult,
} from "./features/game-plan";
import {
  isItemRecQuestion,
  itemRecFeature,
  type ItemRecInput,
  type ItemRecResult,
} from "./features/item-rec";
import {
  voiceQueryFeature,
  type VoiceQueryInput,
  type VoiceQueryResult,
} from "./features/voice-query";
import {
  scoreBrevity,
  scoreBuildPathStructure,
  scoreCategoryDiversity,
  scoreCounterTargeting,
  scorePivotExplanation,
  scoreReasonBrevity,
  scoreStateAwareness,
} from "./features/game-plan/scorers";
import {
  scoreConversationalContinuity,
  scoreDecisiveness,
  scoreGoldAwareness,
} from "./features/voice-query/scorers";
import {
  scoreGoldAwareRecommendations,
  scoreItemAwareness,
  scoreUnnecessaryWarnings,
} from "./features/item-rec/scorers";

// --- Types ---

interface ScorerHints {
  stateAwareness?: Array<
    "grievous-wounds" | "mr-needed" | "enemy-comp" | "existing-items"
  >;
  pivotExpected?: boolean;
  priorRecommendation?: string;
  goldAware?: boolean;
}

interface EvalInput {
  label: string;
  category: string;
  question: string;
  champion: string;
  level: number;
  gameTime: string;
  items: string[];
  gold: number;
  history: Array<{ question: string; answer: string }>;
  expectedReferences?: string[];
  scorerHints?: ScorerHints;
  enemyChampions: string[];
  /**
   * Runs the production code path against the chosen model. Each candidate
   * model rebuilds a fresh session internally (the session is match-scoped,
   * one provider per lifetime), pre-loads prose history, and dispatches to
   * `session.ask(feature, input)`. Returns a scorer-friendly `EvalOutput`
   * normalized from whichever feature handled the fixture.
   */
  runOnce: (model: LanguageModel) => Promise<EvalOutput>;
}

interface EvalOutput {
  answer: string;
  recommendations: Array<{ name: string; fit: string; reasoning: string }>;
  /**
   * Raw build path from the game-plan feature, when applicable. Populated
   * only for game-plan results so the #99 follow-up scorers
   * (`scoreBuildPathStructure`, `scoreCounterTargeting`,
   * `scoreCategoryDiversity`, `scoreReasonBrevity`) can operate on the
   * structured shape rather than the prose `answer`. Other features set
   * this to an empty array; their scorers short-circuit appropriately.
   */
  buildPath: BuildPathItem[];
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
// costs separate from the app's VITE_OPENAI_API_KEY. OpenRouter is injected
// into `createMatchSession` so the production call path (session.ask
// → runFeatureCall → generateText) is reused verbatim.

const OPENROUTER_KEY = process.env.EVAL_OPENROUTER_API_KEY;

if (!OPENROUTER_KEY) {
  throw new Error("EVAL_OPENROUTER_API_KEY required in .env for evalite runs");
}

const openrouterKey: string = OPENROUTER_KEY;

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

// --- #99 follow-up scorers (game-plan only) ---
//
// Each operates on the structured `buildPath` field. Other features set
// buildPath to an empty array; the scorer's empty-array baseline returns
// 1.0 so non-game-plan suites aren't penalized.

const buildPathStructure = createScorer<EvalInput, EvalOutput>({
  name: "Build Path Structure",
  description:
    "Game-plan: build path has exactly 6 items with no duplicate names",
  scorer: ({ output }) => {
    if (output.buildPath.length === 0) return 1;
    return scoreBuildPathStructure(output.buildPath);
  },
});

const counterTargeting = createScorer<EvalInput, EvalOutput>({
  name: "Counter Targeting",
  description:
    "Game-plan: counter items name a roster enemy; non-counter items leave targetEnemy null",
  scorer: ({ input, output }) => {
    if (output.buildPath.length === 0) return 1;
    return scoreCounterTargeting(output.buildPath, input.enemyChampions);
  },
});

const categoryDiversity = createScorer<EvalInput, EvalOutput>({
  name: "Category Diversity",
  description:
    "Game-plan: penalize all-one-category builds and overuse of 'situational'",
  scorer: ({ output }) => {
    if (output.buildPath.length === 0) return 1;
    return scoreCategoryDiversity(output.buildPath);
  },
});

const reasonBrevity = createScorer<EvalInput, EvalOutput>({
  name: "Reason Brevity",
  description: "Game-plan: per-item reasons fit within an 8-word ceiling",
  scorer: ({ output }) => {
    if (output.buildPath.length === 0) return 1;
    return scoreReasonBrevity(output.buildPath);
  },
});

// Gate scorer for the boots-uniqueness rule (#109). Schema enums can't
// express "at most one Boots-tagged item," so this scorer is how we track
// the violation rate across models and prompt revisions. Binary: 1 if the
// build path has ≤1 boots, 0 if it has 2+. gameData is loaded at module
// top-level below; the scorer closure reads it at scoring time.
const bootsUniqueness = createScorer<EvalInput, EvalOutput>({
  name: "Boots Uniqueness",
  description:
    "Game-plan: build path contains at most one Boots-tagged item (#109)",
  scorer: ({ output }) => {
    if (output.buildPath.length === 0) return 1;
    return findDuplicateBoots(output.buildPath, gameData.items).length === 0
      ? 1
      : 0;
  },
});

const GATE_SCORERS = [
  itemAwareness,
  structuredOutput,
  stateAwareness,
  goldAwareRecommendations,
  buildPathStructure,
  bootsUniqueness,
];
const RANKING_SCORERS = [
  brevity,
  decisiveness,
  conversationalContinuity,
  goldAwareness,
  unnecessaryWarnings,
  pivotExplanation,
  counterTargeting,
  categoryDiversity,
  reasonBrevity,
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

const MODE_MAP: Record<string, GameMode> = {
  "aram-mayhem": aramMayhemMode,
  aram: aramMode,
  classic: classicMode,
};

// --- Load fixtures and register evals ---

const fixturesDir = resolve("fixtures/coaching-sessions-v2");
const { loadGameData } = await import("../data-ingest");
const gameData = await loadGameData();

// EVAL_FIXTURE_FILTER narrows which fixture files to load (substring match).
// e.g. EVAL_FIXTURE_FILTER=illaoi npx evalite src/lib/ai/coaching.eval.ts
const fixtureFilter = process.env.EVAL_FIXTURE_FILTER?.toLowerCase();
const fixtureFiles = readdirSync(fixturesDir).filter(
  (f) =>
    f.endsWith(".json") &&
    (!fixtureFilter || f.toLowerCase().includes(fixtureFilter))
);
const fixtures: MultiTurnFixture[] = fixtureFiles.flatMap((file) =>
  JSON.parse(readFileSync(resolve(fixturesDir, file), "utf-8"))
);

const validFixtures = fixtures.filter(
  (f) => f.error === null && f.query.question.length > 5
);

/** Build a GameSnapshot + LiveGameState + enemy champion list for a fixture. */
function buildFixtureState(f: MultiTurnFixture): {
  liveGameState: LiveGameState;
  snapshot: GameSnapshot | null;
  enemyChampions: string[];
} {
  const activePlayerInfo = f.gameState.players.find((p) => p.isActivePlayer);
  const activeTeam = activePlayerInfo?.team ?? "ORDER";
  const enemyPlayers = f.gameState.players.filter((p) => p.team !== activeTeam);

  const enemyStats = new Map<string, ReturnType<typeof computeEnemyStats>>();
  for (const enemy of enemyPlayers) {
    const champData = gameData.champions.get(enemy.championName.toLowerCase());
    if (!champData) continue;
    const enemyItems = enemy.items
      .map((item) => gameData.items.get(item.id))
      .filter((item): item is NonNullable<typeof item> => item != null);
    enemyStats.set(
      enemy.championName,
      computeEnemyStats(champData.stats, enemy.level, enemyItems)
    );
  }

  const liveGameState: LiveGameState = {
    activePlayer: f.gameState.activePlayer,
    players: f.gameState.players,
    gameMode: f.gameState.gameMode,
    lcuGameMode: f.gameModeId === "aram-mayhem" ? "KIWI" : f.gameState.gameMode,
    gameTime: f.gameState.gameTime,
    champSelect: null,
    eogStats: null,
  };

  const snapshot = takeGameSnapshot(
    liveGameState,
    enemyStats,
    gameData,
    f.chosenAugments
  );

  return {
    liveGameState,
    snapshot,
    enemyChampions: enemyPlayers.map((p) => p.championName),
  };
}

/**
 * Pick the feature that owns this fixture and build its typed input.
 *
 * Classification order is load-bearing and must mirror production routing
 * in `CoachingPipeline.tsx`:
 *   1. `augment-fit` — augment offer context outranks anything else.
 *   2. `game-plan` — the "update game plan" voice command.
 *   3. `item-rec` — questions about buying/building items (#113).
 *   4. `voice-query` — everything else: strategic, positional, mechanical.
 *
 * Today's fixtures cover augment-offer calls, item-rec questions, and
 * open-ended voice queries. Game-plan is wired up but not exercised by the
 * current fixture set.
 */
function classifyFixture(
  f: MultiTurnFixture,
  snapshot: GameSnapshot | null
):
  | { kind: "augment-fit"; input: AugmentFitInput }
  | { kind: "game-plan"; input: GamePlanInput }
  | { kind: "item-rec"; input: ItemRecInput }
  | { kind: "voice-query"; input: VoiceQueryInput } {
  if (f.query.augmentOptions && f.query.augmentOptions.length >= 2) {
    return {
      kind: "augment-fit",
      input: {
        snapshot,
        augmentNames: f.query.augmentOptions.map((o) => o.name),
        chosenAugments: f.chosenAugments,
        gameData,
      },
    };
  }
  if (isUpdatePlanCommand(f.query.question)) {
    return {
      kind: "game-plan",
      input: { snapshot },
    };
  }
  if (isItemRecQuestion(f.query.question)) {
    return {
      kind: "item-rec",
      input: { snapshot, question: f.query.question },
    };
  }
  return {
    kind: "voice-query",
    input: { snapshot, question: f.query.question },
  };
}

/** Boundary normalize per-feature results to the shared EvalOutput shape. */
function normalize(
  kind: "augment-fit" | "game-plan" | "item-rec" | "voice-query",
  result: AugmentFitResult | GamePlanResult | ItemRecResult | VoiceQueryResult
): EvalOutput {
  if (kind === "augment-fit") {
    const r = result as AugmentFitResult;
    const answer = augmentFitFeature.summarizeForHistory(r);
    return {
      answer,
      recommendations: r.recommendations,
      buildPath: [],
    };
  }
  if (kind === "game-plan") {
    const r = result as GamePlanResult;
    return {
      answer: r.answer,
      recommendations: r.buildPath.map((item) => ({
        name: item.name,
        fit: "strong",
        reasoning: item.reason,
      })),
      buildPath: r.buildPath,
    };
  }
  if (kind === "item-rec") {
    const r = result as ItemRecResult;
    return {
      answer: r.answer,
      recommendations: r.recommendations,
      buildPath: [],
    };
  }
  const r = result as VoiceQueryResult;
  return {
    answer: r.answer,
    recommendations: r.recommendations,
    buildPath: [],
  };
}

function buildEvalInput(f: MultiTurnFixture): EvalInput {
  const mode = MODE_MAP[f.gameModeId];
  if (!mode) {
    throw new Error(`Unknown gameModeId: ${f.gameModeId}`);
  }

  const { snapshot, enemyChampions } = buildFixtureState(f);
  const baseContext = buildBaseContext({
    mode,
    gameData,
    gameState: f.gameState,
  });
  const classification = classifyFixture(f, snapshot);
  const stateText = snapshot ? formatStateSnapshot(snapshot) : "";

  const runOnce = async (model: LanguageModel): Promise<EvalOutput> => {
    const session = createMatchSession(baseContext, openrouterKey, {
      model,
    });

    if (f.query.history) {
      for (const exchange of f.query.history) {
        session.addUserMessage(stateText, exchange.question);
        session.addAssistantMessage(exchange.answer);
      }
    }

    if (classification.kind === "augment-fit") {
      const { value } = await session.ask(
        augmentFitFeature,
        classification.input
      );
      return normalize("augment-fit", value);
    }
    if (classification.kind === "game-plan") {
      const gamePlanFeature = createGamePlanFeature(gameData);
      const { value } = await session.ask(
        gamePlanFeature,
        classification.input
      );
      return normalize("game-plan", value);
    }
    if (classification.kind === "item-rec") {
      const { value } = await session.ask(itemRecFeature, classification.input);
      return normalize("item-rec", value);
    }
    const { value } = await session.ask(
      voiceQueryFeature,
      classification.input
    );
    return normalize("voice-query", value);
  };

  return {
    label: f.label,
    category: f.category,
    question: f.query.question,
    champion: f.scorerContext.champion,
    level: f.gameState.activePlayer?.level ?? 1,
    gameTime: f.scorerContext.gameTime,
    items: f.scorerContext.items,
    gold: f.scorerContext.gold,
    history: f.query.history ?? [],
    expectedReferences: f.expectedReferences,
    scorerHints: f.scorerHints,
    enemyChampions,
    runOnce,
  };
}

// Group inputs by category
const inputsByCategory = new Map<string, EvalInput[]>();
for (const f of validFixtures) {
  const input = buildEvalInput(f);
  const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
  const list = inputsByCategory.get(categoryLabel) ?? [];
  list.push(input);
  inputsByCategory.set(categoryLabel, list);
}

// Register evals
for (const modelCandidate of models) {
  for (const [category, inputs] of inputsByCategory) {
    if (inputs.length === 0) continue;

    evalite(`${modelCandidate.name} / ${category}`, {
      data: () => inputs.map((input) => ({ input })),

      task: async (input: EvalInput): Promise<EvalOutput> => {
        const output = await input.runOnce(openrouter.chat(modelCandidate.id));

        const fitSummary = output.recommendations
          .map((r) => `${r.name} [${r.fit}]`)
          .join(", ");
        console.log(
          `\n  ${input.champion} lvl${input.level} @${input.gameTime}: ${fitSummary}`
        );

        return output;
      },

      scorers: ALL_SCORERS,

      columns: (result) => [
        { label: "Category", value: category },
        {
          label: "Champion",
          value: `${result.input.champion} lvl${result.input.level} @${result.input.gameTime}`,
        },
        {
          label: "Question",
          value: result.input.question.substring(0, 45),
        },
        {
          label: "Fit Ratings",
          value: result.output.recommendations
            .map((r) => `${r.name} [${r.fit}]`)
            .join(", "),
        },
        {
          label: "Context",
          value: `${result.input.items.length} items, ${result.input.gold}g`,
        },
      ],
    });
  }
}
