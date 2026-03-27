/**
 * Inspect evalite results from the SQLite cache.
 *
 * Subcommands:
 *   pnpm inspect-evals summary              # per-model averages with gate/ranking split
 *   pnpm inspect-evals results              # all results with scores
 *   pnpm inspect-evals failures             # only fixtures that failed a gate
 *   pnpm inspect-evals report               # generate markdown report to reports/
 *
 * Flags:
 *   --model "GPT 5.4 mini"    filter to one model
 *   --run latest               use only the most recent run
 *   --note "prompt v2"         add a note to the report header
 */

import Database from "better-sqlite3";
import { resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";

// --- Scorer categories (must match coaching.eval.ts) ---

const GATE_SCORERS = [
  "Item Awareness",
  "Structured Output",
  "Augment Re-Roll Accuracy",
];
const RANKING_SCORERS = [
  "Brevity",
  "Decisiveness",
  "Conversational Continuity",
  "Gold Awareness",
  "Unnecessary Warnings",
];
const GATE_THRESHOLD = 0.8;

// --- DB setup ---

const DB_PATH = resolve("node_modules/.evalite/cache.sqlite");

let db: Database.Database;
try {
  db = new Database(DB_PATH, { readonly: true });
} catch {
  console.error(`No evalite database found at ${DB_PATH}`);
  console.error("Run 'pnpm eval' first to generate results.");
  process.exit(1);
}

// --- CLI args ---

const rawArgs = process.argv.slice(2).filter((a) => a !== "--");
const subcommand =
  rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs[0] : "summary";
const args = rawArgs.slice(subcommand === rawArgs[0] ? 1 : 0);

const modelFilter = getArg("--model");
const latestOnly = args.includes("--run") && getArg("--run") === "latest";
const reportNote = getArg("--note");

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

// --- Shared types ---

interface GateRanking {
  gates: Map<string, number>;
  ranking: Map<string, number>;
  gatesPassed: boolean;
  rankingAvg: number;
}

function computeGateRanking(scores: Map<string, number>): GateRanking {
  const gates = new Map<string, number>();
  const ranking = new Map<string, number>();

  for (const [name, score] of scores) {
    if (GATE_SCORERS.includes(name)) gates.set(name, score);
    else if (RANKING_SCORERS.includes(name)) ranking.set(name, score);
  }

  const gatesPassed = [...gates.values()].every((s) => s >= GATE_THRESHOLD);
  const rankingValues = [...ranking.values()];
  const rankingAvg =
    rankingValues.length > 0
      ? rankingValues.reduce((a, b) => a + b, 0) / rankingValues.length
      : 0;

  return { gates, ranking, gatesPassed, rankingAvg };
}

function pct(n: number): string {
  return Math.round(n * 100) + "%";
}

// --- Queries ---

function getEvals(): Array<{
  eval_name: string;
  eval_id: number;
  created_at: string;
}> {
  const latestRunFilter = latestOnly
    ? "AND e.run_id = (SELECT id FROM runs ORDER BY id DESC LIMIT 1)"
    : "";
  const modelClause = modelFilter ? "AND e.name LIKE ?" : "";

  const query = db.prepare(`
    SELECT e.name as eval_name, e.id as eval_id, e.created_at
    FROM evals e
    WHERE e.created_at = (SELECT MAX(e2.created_at) FROM evals e2 WHERE e2.name = e.name)
    ${latestRunFilter}
    ${modelClause}
    ORDER BY e.name
  `);

  return modelFilter ? query.all(`%${modelFilter}%`) : query.all();
}

function getScoresForEval(evalId: number): Map<string, number> {
  const rows = db
    .prepare(
      `
    SELECT s.name, ROUND(AVG(s.score), 4) as avg_score
    FROM scores s
    JOIN results r ON s.result_id = r.id
    WHERE r.eval_id = ?
    GROUP BY s.name
  `
    )
    .all(evalId) as Array<{ name: string; avg_score: number }>;

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.name, r.avg_score);
  return map;
}

function getFixtureCount(evalId: number): number {
  const row = db
    .prepare("SELECT COUNT(DISTINCT id) as n FROM results WHERE eval_id = ?")
    .get(evalId) as { n: number };
  return row.n;
}

// --- Subcommand: summary ---

// Short labels for scorers (column headers)
const SCORER_LABELS: Record<string, string> = {
  "Item Awareness": "Items",
  "Structured Output": "StrOut",
  "Augment Re-Roll Accuracy": "ReRoll",
  Brevity: "Brief",
  Decisiveness: "Decisv",
  "Conversational Continuity": "Contin",
  "Gold Awareness": "Gold",
  "Unnecessary Warnings": "NoWarn",
};

function label(scorer: string): string {
  return SCORER_LABELS[scorer] ?? scorer.substring(0, 6);
}

function formatGateCell(gr: GateRanking): string {
  if (gr.gatesPassed) return "PASS";
  const failed = [...gr.gates.entries()]
    .filter(([, v]) => v < GATE_THRESHOLD)
    .map(([k, v]) => `${label(k)} ${pct(v)}`)
    .join(", ");
  return `FAIL: ${failed}`;
}

function cmdSummary() {
  const evals = getEvals();
  if (evals.length === 0) {
    console.log("No eval results found.");
    return;
  }

  // Build summaries
  const summaries: Array<{
    name: string;
    fixtures: number;
    date: string;
    gr: GateRanking;
  }> = [];

  for (const ev of evals) {
    const scores = getScoresForEval(ev.eval_id);
    const gr = computeGateRanking(scores);
    const fixtures = getFixtureCount(ev.eval_id);
    summaries.push({ name: ev.eval_name, fixtures, date: ev.created_at, gr });
  }

  // Sort: passing gates first, then by ranking avg descending
  summaries.sort((a, b) => {
    if (a.gr.gatesPassed !== b.gr.gatesPassed) return a.gr.gatesPassed ? -1 : 1;
    return b.gr.rankingAvg - a.gr.rankingAvg;
  });

  // Collect all ranking scorers present
  const allRanking = new Set<string>();
  for (const s of summaries) {
    for (const k of s.gr.ranking.keys()) allRanking.add(k);
  }
  const rankKeys = [...allRanking];

  // Column widths
  const nameW = 30;
  const fixW = 5;
  const gateW = 22;
  const rankColW = 8;

  // Header
  const rankHeaders = rankKeys.map((k) => label(k).padStart(rankColW)).join("");
  console.log("\n=== EVAL SUMMARY ===\n");
  console.log(
    `${"Suite".padEnd(nameW)} ${"Fix".padStart(fixW)} ${"Gates".padEnd(gateW)}${rankHeaders} ${"Rank".padStart(rankColW)}`
  );
  console.log(
    "-".repeat(nameW + fixW + gateW + rankKeys.length * rankColW + rankColW + 2)
  );

  for (const s of summaries) {
    const gateCell = formatGateCell(s.gr).padEnd(gateW);
    const rankCols = rankKeys
      .map((k) => pct(s.gr.ranking.get(k) ?? 0).padStart(rankColW))
      .join("");

    console.log(
      `${s.name.padEnd(nameW)} ${String(s.fixtures).padStart(fixW)} ${gateCell}${rankCols} ${pct(s.gr.rankingAvg).padStart(rankColW)}`
    );
  }

  // Show failures below the table
  const failQuery = db.prepare(`
    SELECT
      e.name as suite,
      s.name as scorer_name,
      r.input as input_json,
      r.output as output_json
    FROM scores s
    JOIN results r ON s.result_id = r.id
    JOIN evals e ON r.eval_id = e.id
    WHERE e.id IN (${evals.map(() => "?").join(",")})
      AND s.name IN (${GATE_SCORERS.map(() => "?").join(",")})
      AND s.score < ${GATE_THRESHOLD}
    ORDER BY e.name, s.name
  `);

  const failures = failQuery.all(
    ...evals.map((e) => e.eval_id),
    ...GATE_SCORERS
  ) as Array<{
    suite: string;
    scorer_name: string;
    input_json: string;
    output_json: string;
  }>;

  if (failures.length > 0) {
    console.log(`\nGate Failures (${failures.length}):\n`);
    for (const f of failures) {
      let question = "?";
      let items = "";
      let champion = "";
      let gameTime = "";
      try {
        const input = JSON.parse(f.input_json);
        question = input.question ?? "?";
        champion = input.champion ?? "";
        gameTime = input.gameTime ?? "";
        items = input.items?.join(", ") ?? "";
      } catch {
        /* ignore */
      }

      const context = [champion, gameTime ? `@${gameTime}` : ""]
        .filter(Boolean)
        .join(" ");
      const itemsStr = items ? `, owns: ${items}` : "";

      console.log(
        `  [${label(f.scorer_name)}] "${question}" (${context}${itemsStr})`
      );
    }
  }

  console.log();
}

// --- Subcommand: results ---

function cmdResults() {
  const evals = getEvals();
  if (evals.length === 0) {
    console.log("No eval results found.");
    return;
  }

  console.log("\n=== RESULTS (per fixture) ===\n");

  for (const ev of evals) {
    console.log(`--- ${ev.eval_name} (${ev.created_at}) ---\n`);

    const rows = db
      .prepare(
        `
      SELECT
        r.id as result_id,
        r.input as input_json,
        r.output as output_json,
        s.name as scorer_name,
        s.score
      FROM results r
      JOIN scores s ON s.result_id = r.id
      WHERE r.eval_id = ?
      ORDER BY r.id, s.name
    `
      )
      .all(ev.eval_id) as Array<{
      result_id: number;
      input_json: string;
      output_json: string;
      scorer_name: string;
      score: number;
    }>;

    // Group by result
    const byResult = new Map<
      number,
      { input_json: string; scores: Map<string, number> }
    >();
    for (const row of rows) {
      let entry = byResult.get(row.result_id);
      if (!entry) {
        entry = { input_json: row.input_json, scores: new Map() };
        byResult.set(row.result_id, entry);
      }
      entry.scores.set(row.scorer_name, row.score);
    }

    for (const [, entry] of byResult) {
      let question = "?";
      try {
        const input = JSON.parse(entry.input_json);
        question = input.fixture?.question?.substring(0, 55) ?? "?";
      } catch {
        /* ignore */
      }

      const gr = computeGateRanking(entry.scores);
      const failedGates = [...gr.gates.entries()]
        .filter(([, v]) => v < GATE_THRESHOLD)
        .map(([k]) => k);

      const status =
        failedGates.length > 0 ? `FAIL [${failedGates.join(", ")}]` : "PASS";
      console.log(`  ${status.padEnd(35)} ${question}`);
    }
    console.log();
  }
}

// --- Subcommand: failures ---

function cmdFailures() {
  const evals = getEvals();
  if (evals.length === 0) {
    console.log("No eval results found.");
    return;
  }

  console.log("\n=== GATE FAILURES ===\n");

  const failQuery = db.prepare(`
    SELECT
      e.name as model,
      s.name as scorer_name,
      s.score,
      r.input as input_json,
      r.output as output_json
    FROM scores s
    JOIN results r ON s.result_id = r.id
    JOIN evals e ON r.eval_id = e.id
    WHERE e.id IN (${evals.map(() => "?").join(",")})
      AND s.name IN (${GATE_SCORERS.map(() => "?").join(",")})
      AND s.score < ${GATE_THRESHOLD}
    ORDER BY e.name, s.name
  `);

  const failures = failQuery.all(
    ...evals.map((e) => e.eval_id),
    ...GATE_SCORERS
  ) as Array<{
    model: string;
    scorer_name: string;
    score: number;
    input_json: string;
    output_json: string;
  }>;

  if (failures.length === 0) {
    console.log("No gate failures found across any model.");
    return;
  }

  for (const f of failures) {
    let question = "?";
    let items = "?";
    try {
      const input = JSON.parse(f.input_json);
      question = input.fixture?.question ?? "?";
      items = input.fixture?.gameState?.items?.join(", ") ?? "none";
    } catch {
      /* ignore */
    }

    let answer = "?";
    try {
      const output = JSON.parse(f.output_json);
      answer = output.answer?.substring(0, 140) ?? "?";
    } catch {
      /* ignore */
    }

    console.log(`[${f.model}] ${f.scorer_name} = ${pct(f.score)}`);
    console.log(`  Q: ${question}`);
    console.log(`  Items: ${items}`);
    console.log(`  A: ${answer}`);
    console.log();
  }
}

// --- Subcommand: report ---

function cmdReport() {
  const evals = getEvals();
  if (evals.length === 0) {
    console.log("No eval results found.");
    return;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/:/g, "-").split(".")[0];
  const reportsDir = resolve("reports");
  mkdirSync(reportsDir, { recursive: true });

  const lines: string[] = [];
  lines.push(`# Eval Report: ${timestamp}`);
  if (reportNote) lines.push(`\n> ${reportNote}`);
  lines.push("");

  // Config
  lines.push("## Configuration");
  lines.push(
    `- Models: ${evals.map((e) => e.eval_name.replace("Coaching / ", "")).join(", ")}`
  );
  lines.push(`- Gate threshold: ${pct(GATE_THRESHOLD)}`);
  lines.push(`- Gate scorers: ${GATE_SCORERS.join(", ")}`);
  lines.push(`- Ranking scorers: ${RANKING_SCORERS.join(", ")}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");

  const allGates = new Set<string>();
  const allRanking = new Set<string>();
  const modelData: Array<{
    name: string;
    fixtures: number;
    gr: GateRanking;
  }> = [];

  for (const ev of evals) {
    const scores = getScoresForEval(ev.eval_id);
    const gr = computeGateRanking(scores);
    const fixtures = getFixtureCount(ev.eval_id);
    const name = ev.eval_name.replace("Coaching / ", "");
    modelData.push({ name, fixtures, gr });
    for (const k of gr.gates.keys()) allGates.add(k);
    for (const k of gr.ranking.keys()) allRanking.add(k);
  }

  modelData.sort((a, b) => {
    if (a.gr.gatesPassed !== b.gr.gatesPassed) return a.gr.gatesPassed ? -1 : 1;
    return b.gr.rankingAvg - a.gr.rankingAvg;
  });

  const gateKeys = [...allGates];
  const rankKeys = [...allRanking];
  const header = ["Model", "Fix", "Gates", ...gateKeys, ...rankKeys, "Rank"];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (const m of modelData) {
    const gateCols = gateKeys.map((g) => pct(m.gr.gates.get(g) ?? 0));
    const rankCols = rankKeys.map((r) => pct(m.gr.ranking.get(r) ?? 0));
    const gateLabel = m.gr.gatesPassed ? "PASS" : "FAIL";
    lines.push(
      `| ${m.name} | ${m.fixtures} | ${gateLabel} | ${gateCols.join(" | ")} | ${rankCols.join(" | ")} | ${pct(m.gr.rankingAvg)} |`
    );
  }

  lines.push("");

  // Failures
  const failQuery = db.prepare(`
    SELECT
      e.name as model,
      s.name as scorer_name,
      r.input as input_json,
      r.output as output_json
    FROM scores s
    JOIN results r ON s.result_id = r.id
    JOIN evals e ON r.eval_id = e.id
    WHERE e.id IN (${evals.map(() => "?").join(",")})
      AND s.name IN (${GATE_SCORERS.map(() => "?").join(",")})
      AND s.score < ${GATE_THRESHOLD}
    ORDER BY e.name
  `);

  const failures = failQuery.all(
    ...evals.map((e) => e.eval_id),
    ...GATE_SCORERS
  ) as Array<{
    model: string;
    scorer_name: string;
    input_json: string;
    output_json: string;
  }>;

  if (failures.length > 0) {
    lines.push("## Gate Failures");
    lines.push("");
    for (const f of failures) {
      let question = "?";
      try {
        const input = JSON.parse(f.input_json);
        question = input.fixture?.question ?? "?";
      } catch {
        /* ignore */
      }
      let answer = "?";
      try {
        const output = JSON.parse(f.output_json);
        answer = output.answer?.substring(0, 120) ?? "?";
      } catch {
        /* ignore */
      }
      const model = f.model.replace("Coaching / ", "");
      lines.push(`- **${model}** / ${f.scorer_name}: "${question}"`);
      lines.push(`  - Response: ${answer}`);
    }
    lines.push("");
  }

  const filePath = resolve(reportsDir, `${timestamp}.md`);
  writeFileSync(filePath, lines.join("\n"));
  console.log(`Report saved to ${filePath}`);
}

// --- Subcommand: runs ---

function cmdRuns() {
  const limit = Number(getArg("--limit")) || 30;

  const rows = db
    .prepare(
      `
    SELECT
      e.id as eval_id,
      e.name as suite,
      e.created_at,
      COUNT(DISTINCT r.id) as fixtures,
      ROUND(AVG(s.score) * 100, 1) as avg_score,
      SUM(CASE WHEN s.name IN (${GATE_SCORERS.map(() => "?").join(",")}) AND s.score < ${GATE_THRESHOLD} THEN 1 ELSE 0 END) as gate_failures
    FROM evals e
    JOIN results r ON r.eval_id = e.id
    JOIN scores s ON s.result_id = r.id
    GROUP BY e.id
    ORDER BY e.created_at DESC
    LIMIT ?
  `
    )
    .all(...GATE_SCORERS, limit) as Array<{
    eval_id: number;
    suite: string;
    created_at: string;
    fixtures: number;
    avg_score: number;
    gate_failures: number;
  }>;

  if (rows.length === 0) {
    console.log("No runs found.");
    return;
  }

  const suiteW = 28;
  const fixW = 5;
  const scoreW = 7;
  const gateW = 7;

  console.log(`\n=== ALL RUNS (last ${limit}) ===\n`);
  console.log(
    `${"Timestamp".padEnd(20)} ${"Suite".padEnd(suiteW)} ${"Fix".padStart(fixW)} ${"Score".padStart(scoreW)} ${"Fails".padStart(gateW)}`
  );
  console.log("-".repeat(20 + suiteW + fixW + scoreW + gateW + 4));

  for (const r of rows) {
    const time = r.created_at.substring(0, 19);
    const fails = r.gate_failures > 0 ? String(r.gate_failures) : "";
    console.log(
      `${time.padEnd(20)} ${r.suite.padEnd(suiteW)} ${String(r.fixtures).padStart(fixW)} ${(r.avg_score + "%").padStart(scoreW)} ${fails.padStart(gateW)}`
    );
  }
  console.log();
}

// --- Dispatch ---

switch (subcommand) {
  case "summary":
    cmdSummary();
    break;
  case "runs":
    cmdRuns();
    break;
  case "results":
    cmdResults();
    break;
  case "failures":
    cmdFailures();
    break;
  case "report":
    cmdReport();
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error("Available: summary, runs, results, failures, report");
    process.exit(1);
}

db.close();
