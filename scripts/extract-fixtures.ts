/**
 * Extract structured eval fixtures from a coaching log file.
 *
 * Parses the coaching log format into structured JSON test cases
 * for the Evalite evaluation pipeline.
 *
 * Usage:
 *   pnpm extract-fixtures <path-to-coaching-log>
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

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

const logPath = process.argv[2];
if (!logPath) {
  console.error("Usage: pnpm extract-fixtures <path-to-coaching-log>");
  process.exit(1);
}

const raw = readFileSync(resolve(logPath), "utf-8");
const lines = raw.split("\n");

const fixtures: CoachingFixture[] = [];
let i = 0;

while (i < lines.length) {
  // Find the start of a coaching request
  if (!lines[i].includes("=== COACHING REQUEST ===")) {
    i++;
    continue;
  }

  const timestamp = lines[i].match(/^\[([^\]]+)\]/)?.[1] ?? "";

  // Parse header fields
  i++;
  const header: Record<string, string> = {};
  while (
    i < lines.length &&
    lines[i].trim() !== "" &&
    !lines[i].startsWith("---")
  ) {
    const match = lines[i].match(/^(\w[\w\s]*?):\s*(.+)$/);
    if (match) {
      header[match[1].trim()] = match[2].trim();
    }
    i++;
  }

  // Find system prompt
  let systemPrompt = "";
  while (i < lines.length && !lines[i].includes("--- SYSTEM PROMPT ---")) {
    i++;
  }
  i++; // skip the separator line
  const systemLines: string[] = [];
  while (i < lines.length && !lines[i].includes("--- USER PROMPT ---")) {
    systemLines.push(lines[i]);
    i++;
  }
  systemPrompt = systemLines.join("\n").trim();

  // Find user prompt
  i++; // skip the separator line
  const userLines: string[] = [];
  while (
    i < lines.length &&
    !lines[i].includes("--- RESPONSE") &&
    !lines[i].includes("--- ERROR") &&
    !lines[i].includes("=== END COACHING REQUEST ===")
  ) {
    userLines.push(lines[i]);
    i++;
  }
  const userPrompt = userLines.join("\n").trim();

  // Parse game state from user prompt
  const gameState = parseGameState(userPrompt, header);

  // Parse response or error
  let response: CoachingFixture["response"] = null;
  let error: string | null = null;

  if (i < lines.length && lines[i].includes("--- RESPONSE")) {
    const latencyMatch = lines[i].match(/\((\d+)ms\)/);
    const latencyMs = latencyMatch ? parseInt(latencyMatch[1]) : 0;
    i++;

    // Parse tokens line
    let tokensIn = 0;
    let tokensOut = 0;
    if (i < lines.length && lines[i].startsWith("Tokens:")) {
      const tokenMatch = lines[i].match(/(\d+)in\s*\/\s*(\d+)out/);
      if (tokenMatch) {
        tokensIn = parseInt(tokenMatch[1]);
        tokensOut = parseInt(tokenMatch[2]);
      }
      i++;
    }

    // Parse answer
    let answer = "";
    if (i < lines.length && lines[i].startsWith("Answer:")) {
      answer = lines[i].replace(/^Answer:\s*/, "");
      i++;
    }

    // Skip recommendation lines until END
    while (
      i < lines.length &&
      !lines[i].includes("=== END COACHING REQUEST ===")
    ) {
      i++;
    }

    response = { answer, latencyMs, tokensIn, tokensOut };
  } else if (i < lines.length && lines[i].includes("--- ERROR")) {
    const latencyMatch = lines[i].match(/\((\d+)ms\)/);
    i++;
    error = lines[i]?.trim() ?? "Unknown error";
    // Skip to END
    while (
      i < lines.length &&
      !lines[i].includes("=== END COACHING REQUEST ===")
    ) {
      i++;
    }
  }

  const label = buildLabel(header, gameState);

  fixtures.push({
    label,
    index: fixtures.length,
    timestamp,
    model: header["Model"] ?? "unknown",
    question: header["Question"] ?? "",
    systemPrompt,
    userPrompt,
    gameState,
    response,
    error,
  });

  i++;
}

// Write output
const outPath = resolve(
  "fixtures/coaching-sessions/2026-03-26-warwick-aram-mayhem.json"
);
writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
console.log(`Extracted ${fixtures.length} fixtures to ${outPath}`);

// Print summary
for (const f of fixtures) {
  const status = f.error ? "ERROR" : `${f.response?.latencyMs}ms`;
  console.log(`  [${f.index}] ${status} | ${f.question.substring(0, 60)}`);
}

// --- Helpers ---

function parseGameState(
  userPrompt: string,
  header: Record<string, string>
): CoachingFixture["gameState"] {
  // Champion and level from header
  const champMatch = header["Champion"]?.match(/^(.+?)\s+Lv(\d+)/);
  const champion = champMatch?.[1] ?? "Unknown";
  const level = champMatch ? parseInt(champMatch[2]) : 0;

  // Items from header
  const itemsRaw = header["Items"] ?? "None";
  const items =
    itemsRaw === "None" ? [] : itemsRaw.split(",").map((s) => s.trim());

  // Augments from header
  const augmentsRaw = header["Augments"] ?? "None";
  const augments =
    augmentsRaw === "None" ? [] : augmentsRaw.split(",").map((s) => s.trim());

  // Enemies from header
  const enemiesRaw = header["Enemies"] ?? "";
  const enemies = enemiesRaw ? enemiesRaw.split(",").map((s) => s.trim()) : [];

  // Gold from user prompt
  const goldMatch = userPrompt.match(/(\d+)\s*gold available/);
  const gold = goldMatch ? parseInt(goldMatch[1]) : 0;

  // Game time from user prompt
  const timeMatch = userPrompt.match(/## Game Time:\s*(.+)/);
  const gameTime = timeMatch?.[1]?.trim() ?? "0:00";

  // KDA from user prompt
  const kdaMatch = userPrompt.match(/(\d+\/\d+\/\d+)\s*KDA/);
  const kda = kdaMatch?.[1] ?? "0/0/0";

  return { champion, level, items, augments, enemies, gold, gameTime, kda };
}

function buildLabel(
  header: Record<string, string>,
  gameState: CoachingFixture["gameState"]
): string {
  const question = header["Question"] ?? "";
  const time = gameState.gameTime;
  const champ = gameState.champion;

  if (question.includes(",") && question.split(",").length >= 2) {
    return `${champ} @${time}: augment choice`;
  }
  if (/item|buy|build/i.test(question)) {
    return `${champ} @${time}: item question`;
  }
  if (/chose|picked|took|selected/i.test(question)) {
    return `${champ} @${time}: augment confirmation`;
  }
  return `${champ} @${time}: general question`;
}
