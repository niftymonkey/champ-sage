/**
 * Model candidate discovery for Champ Sage using pickai.
 *
 * Uses metadata scoring + benchmark data to find the best model
 * candidates for real-time League of Legends coaching.
 *
 * Usage:
 *   pnpm discover-candidates
 *   pnpm discover-candidates -- --benchmarks lmarena
 *
 * Requires ARTIFICIAL_ANALYSIS_API_KEY in .env for AA benchmarks.
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  fromModelsDev,
  recommend,
  scoreModels,
  applyFilter,
  minMaxCriterion,
  matchesModel,
  costEfficiency,
  recency,
  perProvider,
  perFamily,
  ALL_KNOWN_PROVIDERS,
  type PurposeProfile,
  type ScoringCriterion,
  type Model,
  type ScoredModel,
  type ModelFilter,
} from "pickai";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

// --- CLI args ---

const args = process.argv.slice(2).filter((a) => a !== "--");
const benchmarkSource = args.includes("--benchmarks")
  ? (args[args.indexOf("--benchmarks") + 1] ?? "aa")
  : "aa";

// --- Fetch models ---

console.log("Fetching models from models.dev...");
const rawModels = await fromModelsDev();

// Fix metadata gaps: Anthropic models support structured output but
// models.dev doesn't report it. Override for known-good families.
const STRUCTURED_OUTPUT_OVERRIDES = ["anthropic"];
const allModels = rawModels.map((m) =>
  STRUCTURED_OUTPUT_OVERRIDES.includes(m.provider) && !m.structuredOutput
    ? { ...m, structuredOutput: true }
    : m
);
console.log(`  ${allModels.length} models loaded\n`);

// --- Benchmark data ---

interface BenchmarkEntry {
  modelId: string;
  quality: number;
  ifScore?: number;
  gpqa?: number;
  outputTokensPerSecond?: number;
  timeToFirstToken?: number;
}

let benchmarks: BenchmarkEntry[];
let benchmarkLabel: string;

if (benchmarkSource === "lmarena") {
  console.log("Fetching LMArena benchmark scores...");
  const response = await fetch(
    "https://raw.githubusercontent.com/nakasyou/lmarena-history/main/output/scores.json"
  );
  const scoresData = await response.json();
  const dates = Object.keys(scoresData).sort();
  const latestScores = scoresData[dates[dates.length - 1]].text.overall;
  benchmarks = Object.entries(latestScores).map(([modelId, score]) => ({
    modelId,
    quality: score as number,
  }));
  benchmarkLabel = `LMArena (${dates[dates.length - 1]})`;
  console.log(`  ${benchmarks.length} models with scores\n`);
} else {
  const aaKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!aaKey) {
    console.error(
      "ARTIFICIAL_ANALYSIS_API_KEY not found in .env\n" +
        "Get one at https://artificialanalysis.ai and add it to .env"
    );
    process.exit(1);
  }
  console.log("Fetching Artificial Analysis benchmark scores...");
  const response = await fetch(
    "https://artificialanalysis.ai/api/v2/data/llms/models",
    { headers: { "x-api-key": aaKey } }
  );
  const aaData = await response.json();
  benchmarks = aaData.data
    .filter((m: Record<string, unknown>) => m.evaluations)
    .map((m: Record<string, unknown>) => {
      const evals = m.evaluations as Record<string, number | null>;
      return {
        modelId: m.slug as string,
        quality: evals.artificial_analysis_intelligence_index ?? 0,
        ifScore: evals.ifbench ?? undefined,
        gpqa: evals.gpqa ?? undefined,
        outputTokensPerSecond:
          (m.median_output_tokens_per_second as number) ?? undefined,
        timeToFirstToken:
          (m.median_time_to_first_token_seconds as number) ?? undefined,
      };
    });
  benchmarkLabel = `Artificial Analysis (${benchmarks.length} models)`;
  console.log(`  ${benchmarks.length} models with scores\n`);
}

// --- Custom criteria from benchmarks ---

const qualityScore: ScoringCriterion = minMaxCriterion((model) => {
  const match = benchmarks.find((b) => matchesModel(b.modelId, model.id));
  return match?.quality;
});

const hasIFScores = benchmarks.some((b) => b.ifScore !== undefined);
const instructionFollowing: ScoringCriterion = minMaxCriterion((model) => {
  const match = benchmarks.find((b) => matchesModel(b.modelId, model.id));
  return match?.ifScore;
});

const hasGPQA = benchmarks.some((b) => b.gpqa !== undefined);
const reasoningScore: ScoringCriterion = minMaxCriterion((model) => {
  const match = benchmarks.find((b) => matchesModel(b.modelId, model.id));
  return match?.gpqa;
});

const hasSpeed = benchmarks.some((b) => b.outputTokensPerSecond !== undefined);
const speedScore: ScoringCriterion = minMaxCriterion((model) => {
  const match = benchmarks.find((b) => matchesModel(b.modelId, model.id));
  return match?.outputTokensPerSecond;
});

// --- Champ Sage coaching profile ---
//
// What matters for real-time game coaching:
//
// - Reasoning (GPQA, weight 3): the model needs to reason about complex
//   game states — team compositions, augment synergies, item builds.
//
// - Speed (output tokens/sec, weight 3): responses must feel instant
//   during gameplay. Measured throughput, not a cost proxy.
//
// - Quality (intelligence index, weight 2): general capability baseline.
//
// - Instruction following (weight 2): coaching responses need to follow
//   structured output formats consistently.
//
// - Cost (weight 1): tiebreaker. Cheap is nice but not at the expense
//   of quality or speed.
//
// - Recency (weight 1): tiebreaker. Newer models are generally better
//   but game knowledge comes from our context, not training data.
//
// What we filter instead of scoring:
// - Context: minimum 32K (game state + augment catalog + champion data)
// - Structured output: required for parseable recommendations

const baseFilter: ModelFilter = {
  providers: [...ALL_KNOWN_PROVIDERS],
  minContext: 32_000,
  minOutput: 2_000,
  excludeDeprecated: true,
  structuredOutput: true,
};

const stableOnly = (m: Model) => {
  if (m.status === "beta") return false;
  const name = m.name.toLowerCase();
  if (name.includes("preview")) return false;
  return true;
};

const criteria = [
  ...(hasGPQA ? [{ criterion: reasoningScore, weight: 3 }] : []),
  ...(hasSpeed ? [{ criterion: speedScore, weight: 3 }] : []),
  { criterion: qualityScore, weight: 2 },
  ...(hasIFScores ? [{ criterion: instructionFollowing, weight: 2 }] : []),
  { criterion: costEfficiency, weight: 1 },
  { criterion: recency, weight: 1 },
];

const RealtimeCoaching: PurposeProfile = {
  filter: baseFilter,
  criteria,
};

console.log(`=== CHAMP SAGE CANDIDATE DISCOVERY [${benchmarkLabel}] ===\n`);
console.log(
  "  Weights: " +
    (hasGPQA ? "reasoning=3, " : "") +
    (hasSpeed ? "speed=3, " : "") +
    "quality=2" +
    (hasIFScores ? ", instruction-following=2" : "") +
    ", cost=1, recency=1\n"
);

// --- Speed-first candidates (cheap + good) ---

console.log("--- SPEED TIER: Top 10 (optimized for fast inference) ---\n");

const speedResults = recommend(allModels, RealtimeCoaching, {
  filter: (m) => {
    if (!stableOnly(m)) return false;
    if (!m.cost?.input) return true;
    return m.cost.input < 2; // Under $2/M input — fast inference tier
  },
  constraints: [perProvider(2), perFamily(1)],
  limit: 10,
});

printResults(speedResults);

// --- Balanced candidates (quality + reasonable speed) ---

console.log("\n--- BALANCED TIER: Top 10 ($2-10/M input) ---\n");

const balancedResults = recommend(allModels, RealtimeCoaching, {
  filter: (m) => {
    if (!stableOnly(m)) return false;
    if (!m.cost?.input) return false;
    return m.cost.input >= 2 && m.cost.input <= 10;
  },
  constraints: [perProvider(2), perFamily(1)],
  limit: 10,
});

printResults(balancedResults);

// --- Quality tier (best regardless of cost) ---

console.log("\n--- QUALITY TIER: Top 10 (best overall, any cost) ---\n");

const qualityProfile: PurposeProfile = {
  filter: baseFilter,
  criteria: [
    ...(hasGPQA ? [{ criterion: reasoningScore, weight: 4 }] : []),
    { criterion: qualityScore, weight: 3 },
    ...(hasIFScores ? [{ criterion: instructionFollowing, weight: 2 }] : []),
    { criterion: recency, weight: 1 },
    { criterion: costEfficiency, weight: 1 },
  ],
};

const qualityResults = recommend(allModels, qualityProfile, {
  filter: stableOnly,
  constraints: [perProvider(2), perFamily(1)],
  limit: 10,
});

printResults(qualityResults);

// --- Diverse overview ---

console.log("\n--- ALL TIERS: Top 15 (diverse providers/families) ---\n");

const diverseResults = recommend(allModels, RealtimeCoaching, {
  filter: stableOnly,
  constraints: [perProvider(3), perFamily(1)],
  limit: 15,
});

printResults(diverseResults);

// --- Summary ---

const allCandidates = new Map<string, ScoredModel<Model>>();
for (const m of [
  ...speedResults,
  ...balancedResults,
  ...qualityResults,
  ...diverseResults,
]) {
  if (!allCandidates.has(m.id)) allCandidates.set(m.id, m);
}

console.log(
  `\n=== UNIQUE CANDIDATES ACROSS ALL TIERS (${allCandidates.size}) ===\n`
);

const sorted = [...allCandidates.values()].sort((a, b) => b.score - a.score);
for (const m of sorted) {
  const bm = lookupBenchmark(m);
  const cost = m.cost?.input ? `$${m.cost.input}/M` : "n/a";
  console.log(
    `  ${m.score.toFixed(3)} | ${m.name} (${m.provider}) | GPQA: ${bm?.gpqa ?? "n/a"} | speed: ${fmtSpeed(bm?.outputTokensPerSecond)} | cost: ${cost}`
  );
}

console.log(
  `\nRecommendation: Start with the top speed-tier candidate for real-time coaching.`
);
console.log(
  `Fall back to balanced tier if quality is insufficient during gameplay testing.\n`
);

// --- Helpers ---

function lookupBenchmark(model: Model): BenchmarkEntry | undefined {
  return benchmarks.find((b) => matchesModel(b.modelId, model.id));
}

function fmtSpeed(tps: number | undefined): string {
  if (tps === undefined) return "n/a";
  return `${Math.round(tps)} tok/s`;
}

function printResults(results: ScoredModel<Model>[]) {
  for (const m of results) {
    const bm = lookupBenchmark(m);
    const cost = m.cost?.input ? `$${m.cost.input}/M` : "n/a";
    console.log(
      `  ${m.score.toFixed(3)} | ${m.name.substring(0, 30).padEnd(31)} | ${m.provider.padEnd(12)} | GPQA: ${String(bm?.gpqa ?? "n/a").padStart(5)} | quality: ${String(bm?.quality ?? "n/a").padStart(5)} | speed: ${fmtSpeed(bm?.outputTokensPerSecond).padStart(10)} | cost: ${cost.padStart(8)}`
    );
  }
}
