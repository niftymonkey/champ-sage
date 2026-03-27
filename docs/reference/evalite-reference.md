# Evalite Reference

How we use Evalite for the model evaluation pipeline (#10). Based on Evalite docs and patterns from the review-kit project.

## What Evalite Is

Evalite is a testing framework for AI-powered apps. Where normal tests give pass/fail, evals give a score from 0-1 based on how well the app is performing. It uses `.eval.ts` files (like `.test.ts` files) and provides a UI for viewing results over time.

## Project Structure

Evalite is designed for `.eval.ts` files to live alongside your code, not in a separate package. Our structure:

```
src/lib/ai/coaching.eval.ts              -- eval cases using real game states
src/lib/ai/scorers/                      -- custom scorer modules
src/lib/ai/scorers/item-awareness.ts     -- does response acknowledge current items?
src/lib/ai/scorers/augment-accuracy.ts   -- does augment recommendation match context?
src/lib/ai/scorers/response-format.ts    -- brevity, decisiveness checks
fixtures/coaching-sessions/              -- structured test data from real game logs
evalite.config.ts                        -- framework configuration
```

## Core API

### Eval file structure

```typescript
import { evalite } from "evalite";

evalite("Coaching Quality", {
  data: () => [{ input: gameState, expected: expectedBehavior }],
  task: async (input) => {
    // Call the LLM with the input and return the response
  },
  scorers: [itemAwareness, augmentAccuracy, responseFormat],
});
```

- `data`: array of test cases, each with `input` and optional `expected`
- `task`: the function to evaluate (calls the LLM)
- `scorers`: array of scorer functions that rate the output 0-1

### Creating scorers

```typescript
import { createScorer } from "evalite";

const itemAwareness = createScorer<InputType, OutputType>({
  name: "Item Awareness",
  description:
    "Checks that the model does not recommend items the player already owns",
  scorer: ({ input, output }) => {
    // Return 0-1 score
  },
});
```

Scorers can return a plain number (0-1) or an object with `score` and `metadata` for additional context shown in the UI.

### LLM-as-judge scorers

For subjective quality scoring, use a separate model as a judge:

```typescript
import { generateObject } from "ai";

const recommendationQuality = createScorer<InputType, OutputType>({
  name: "Recommendation Quality",
  scorer: async ({ input, output }) => {
    const { object } = await generateObject({
      model: judgeModel,
      prompt: `Rate this coaching response...`,
      schema: z.object({
        score: z.number().min(1).max(5),
        rationale: z.string(),
      }),
    });
    return {
      score: object.score / 5,
      metadata: { rationale: object.rationale },
    };
  },
});
```

The judge model should not be a candidate under evaluation (avoids circular scoring).

## Configuration

`evalite.config.ts` at project root:

```typescript
import { defineConfig } from "evalite/config";

export default defineConfig({
  testTimeout: 60_000,
  maxConcurrency: 5,
  scoreThreshold: 80,
  setupFiles: ["dotenv/config"],
});
```

Key options:

- `testTimeout`: max time per test case (default 30s, we likely need 60s for LLM calls)
- `maxConcurrency`: parallel test cases (default 5)
- `scoreThreshold`: minimum average score, exits with code 1 if below (useful for CI)
- `setupFiles`: files to run before tests (e.g., load .env for API keys)
- `trialCount`: run each case N times to measure variance (useful for response stability scoring)

## Running

```bash
npx evalite                           # run all .eval.ts files once
npx evalite watch                     # re-run on file changes
npx evalite serve                     # launch the results UI
npx evalite src/lib/ai/coaching.eval.ts  # run a specific file
```

Results are stored in a SQLite database at `node_modules/.evalite/cache.sqlite` and persist across runs for comparison.

## Scorer Design Pattern from review-kit

Review-kit uses a two-tier scorer pattern that maps well to our needs:

**Gate scorers** (threshold-based, binary viability):

- Any model failing a gate is not viable, regardless of other scores
- Examples: structured output compliance, context awareness, re-roll accuracy
- We use threshold 0.80

**Ranking scorers** (0-1 scale, comparative):

- Used to compare viable models against each other
- Examples: recommendation quality, response stability, situational reasoning
- Averaged to produce an overall ranking score

Scorers are exported in groups:

```typescript
export const GATE_SCORERS = [
  itemAwareness,
  augmentRerollAccuracy,
  responseFormat,
];
export const RANKING_SCORERS = [
  recommendationQuality,
  responseStability,
  buildPathCoherence,
];
export const ALL_SCORERS = [...GATE_SCORERS, ...RANKING_SCORERS];
```

## Multi-Model Evaluation

To evaluate multiple models, register a separate eval suite per model:

```typescript
for (const model of candidateModels) {
  evalite(`Coaching / ${model.name}`, {
    data: () => fixtures,
    task: async (input) => callModel(model, input),
    scorers: ALL_SCORERS,
  });
}
```

This produces separate results per model in the Evalite UI, allowing side-by-side comparison.

## Test Fixture Format

Fixtures are extracted from real coaching logs. Each fixture captures a single coaching exchange:

```typescript
interface CoachingFixture {
  label: string; // human-readable description
  systemPrompt: string; // as sent to the model
  userPrompt: string; // as sent to the model
  question: string; // the player's question
  gameState: {
    champion: string;
    level: number;
    items: string[]; // item names the player currently owns
    augments: string[]; // augment names the player has chosen
    enemies: string[]; // enemy champion names
    gold: number;
  };
  expectedBehavior: {
    shouldNotRecommendItems?: string[]; // items player already owns
    shouldConsiderEnemies?: string[]; // enemies relevant to the answer
    shouldFollowRerollRules?: boolean;
    maxSentences?: number;
  };
}
```

The `gameState` fields enable deterministic scorers. The `expectedBehavior` fields define what to check for each specific case.
