/**
 * Extract structured eval fixtures from a coaching log file.
 *
 * Parses coaching log entries into CoachingContext + CoachingQuery objects
 * so the eval can call buildUserPrompt directly.
 *
 * Usage:
 *   pnpm extract-fixtures <path-to-coaching-log>
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

interface ExtractedFixture {
  label: string;
  index: number;
  timestamp: string;
  model: string;
  context: {
    champion: {
      name: string;
      level: number;
      abilities: string;
      statProfile: string | null;
    };
    currentItems: Array<{ name: string; description: string }>;
    currentGold: number;
    kda: { kills: number; deaths: number; assists: number };
    currentAugments: Array<{ name: string; description: string }>;
    enemyTeam: Array<{
      champion: string;
      items: Array<{ name: string; description: string }>;
    }>;
    allyTeam: Array<{ champion: string }>;
    teamAnalysis: string | null;
    augmentSets: Array<{
      name: string;
      bonuses: Array<{ threshold: number; description: string }>;
    }>;
    gameMode: string;
    lcuGameMode: string;
    gameTime: number;
    balanceOverrides: string | null;
  };
  query: {
    question: string;
    history: Array<{ question: string; answer: string }>;
    augmentOptions: Array<{
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
}

const logPath = process.argv[2];
if (!logPath) {
  console.error("Usage: pnpm extract-fixtures <path-to-coaching-log>");
  process.exit(1);
}

const raw = readFileSync(resolve(logPath), "utf-8");
const lines = raw.split("\n");

const fixtures: ExtractedFixture[] = [];
let i = 0;

while (i < lines.length) {
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
    if (match) header[match[1].trim()] = match[2].trim();
    i++;
  }

  // Skip to system prompt
  while (i < lines.length && !lines[i].includes("--- SYSTEM PROMPT ---")) i++;
  i++;
  // Skip system prompt content (we rebuild it from code)
  while (i < lines.length && !lines[i].includes("--- USER PROMPT ---")) i++;
  i++;

  // Capture user prompt for parsing
  const userPromptLines: string[] = [];
  while (
    i < lines.length &&
    !lines[i].includes("--- RESPONSE") &&
    !lines[i].includes("--- ERROR") &&
    !lines[i].includes("=== END COACHING REQUEST ===")
  ) {
    userPromptLines.push(lines[i]);
    i++;
  }
  const userPrompt = userPromptLines.join("\n");

  // Parse response or error
  let response: ExtractedFixture["response"] = null;
  let error: string | null = null;

  if (i < lines.length && lines[i].includes("--- RESPONSE")) {
    const latencyMatch = lines[i].match(/\((\d+)ms\)/);
    const latencyMs = latencyMatch ? parseInt(latencyMatch[1]) : 0;
    i++;
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
    let answer = "";
    if (i < lines.length && lines[i].startsWith("Answer:")) {
      answer = lines[i].replace(/^Answer:\s*/, "");
      i++;
    }
    while (
      i < lines.length &&
      !lines[i].includes("=== END COACHING REQUEST ===")
    )
      i++;
    response = { answer, latencyMs, tokensIn, tokensOut };
  } else if (i < lines.length && lines[i].includes("--- ERROR")) {
    i++;
    error = lines[i]?.trim() ?? "Unknown error";
    while (
      i < lines.length &&
      !lines[i].includes("=== END COACHING REQUEST ===")
    )
      i++;
  }

  // Parse structured data from user prompt
  const context = parseContext(userPrompt, header);
  const query = parseQuery(userPrompt, header);
  const label = buildLabel(header, context);

  fixtures.push({
    label,
    index: fixtures.length,
    timestamp,
    model: header["Model"] ?? "unknown",
    context,
    query,
    response,
    error,
  });

  i++;
}

const outPath = resolve(
  "fixtures/coaching-sessions/2026-03-26-warwick-aram-mayhem.json"
);
writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
console.log(`Extracted ${fixtures.length} fixtures to ${outPath}`);

for (const f of fixtures) {
  const status = f.error ? "ERROR" : `${f.response?.latencyMs}ms`;
  console.log(
    `  [${f.index}] ${status} | ${f.query.question.substring(0, 60)}`
  );
}

// --- Parsers ---

function parseContext(
  userPrompt: string,
  header: Record<string, string>
): ExtractedFixture["context"] {
  const champMatch = header["Champion"]?.match(/^(.+?)\s+Lv(\d+)/);
  const champion = champMatch?.[1] ?? "Unknown";
  const level = champMatch ? parseInt(champMatch[2]) : 0;

  // KDA from user prompt
  const kdaMatch = userPrompt.match(/(\d+)\/(\d+)\/(\d+)\s*KDA/);
  const kda = kdaMatch
    ? {
        kills: parseInt(kdaMatch[1]),
        deaths: parseInt(kdaMatch[2]),
        assists: parseInt(kdaMatch[3]),
      }
    : { kills: 0, deaths: 0, assists: 0 };

  // Stat profile
  const statMatch = userPrompt.match(/### Stat Profile\n(.+)/);
  const statProfile = statMatch?.[1]?.trim() ?? null;

  // Abilities
  const abilitiesMatch = userPrompt.match(
    /### Abilities\n([\s\S]*?)(?=\n\n###|\n\n##)/
  );
  const abilities = abilitiesMatch?.[1]?.trim() ?? "";

  // Balance overrides
  const balanceMatch = userPrompt.match(
    /### Balance Overrides\n([\s\S]*?)(?=\n\n###|\n\n##)/
  );
  const balanceOverrides = balanceMatch?.[1]?.trim() ?? null;

  // Gold
  const goldMatch = userPrompt.match(/(\d+)\s*gold available/);
  const currentGold = goldMatch ? parseInt(goldMatch[1]) : 0;

  // Game time (convert "M:SS" to seconds)
  const timeMatch = userPrompt.match(/Game Time:\s*(\d+):(\d+)/);
  const gameTime = timeMatch
    ? parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2])
    : 0;

  // Current items from user prompt
  const currentItems = parseItems(
    userPrompt,
    /### Current Items[^\n]*\n([\s\S]*?)(?=\n\n###|\n\n##)/
  );

  // Current augments
  const currentAugments = parseItems(
    userPrompt,
    /### Current Augments\n([\s\S]*?)(?=\n\n###|\n\n##)/
  );

  // Team analysis
  const teamMatch = userPrompt.match(/### Team Analysis\n(.+)/);
  const teamAnalysis = teamMatch?.[1]?.trim() ?? null;

  // Ally team
  const allyMatch = userPrompt.match(
    /### Ally Team\n([\s\S]*?)(?=\n\n###|\n\n##)/
  );
  const allyTeam = allyMatch
    ? allyMatch[1]
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => ({
          champion: l.replace(/^- /, "").trim(),
        }))
    : [];

  // Enemy team
  const enemyMatch = userPrompt.match(/### Enemy Team\n([\s\S]*?)(?=\n\n##)/);
  const enemyTeam = enemyMatch
    ? enemyMatch[1]
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => {
          const parts = l.replace(/^- /, "").split(": ");
          const champName = parts[0].trim();
          const itemStr = parts.slice(1).join(": ").trim();
          const items =
            itemStr && itemStr !== "No items"
              ? itemStr
                  .split(", ")
                  .map((n) => ({ name: n.trim(), description: "" }))
              : [];
          return { champion: champName, items };
        })
    : [];

  // Mode from header
  const modeMatch = header["Mode"]?.match(/^(\w+)/);
  const gameMode = modeMatch?.[1] ?? "KIWI";

  return {
    champion: { name: champion, level, abilities, statProfile },
    currentItems,
    currentGold,
    kda,
    currentAugments,
    enemyTeam,
    allyTeam,
    teamAnalysis,
    augmentSets: [],
    gameMode,
    lcuGameMode: gameMode,
    gameTime,
    balanceOverrides,
  };
}

function parseQuery(
  userPrompt: string,
  header: Record<string, string>
): ExtractedFixture["query"] {
  const question = header["Question"] ?? "";

  // Parse history
  const history: Array<{ question: string; answer: string }> = [];
  const historyMatch = userPrompt.match(
    /## Recent Conversation\n\n([\s\S]*?)(?=\n\n## )/
  );
  if (historyMatch) {
    const hLines = historyMatch[1].split("\n");
    for (let j = 0; j < hLines.length; j++) {
      const pm = hLines[j].match(/^\*\*Player:\*\*\s*(.+)/);
      if (pm) {
        const cm = hLines[j + 1]?.match(/^\*\*Coach:\*\*\s*(.+)/);
        if (cm) {
          history.push({ question: pm[1], answer: cm[1] });
          j++;
        }
      }
    }
  }

  // Parse augment options
  const augmentOptions: ExtractedFixture["query"]["augmentOptions"] = [];
  const augOptMatch = userPrompt.match(
    /## Augment Options Being Offered\n\n[\s\S]*?\n\n([\s\S]*?)(?=\n\n## Question)/
  );
  if (augOptMatch) {
    const optLines = augOptMatch[1]
      .split("\n")
      .filter((l) => l.startsWith("- **"));
    for (const line of optLines) {
      const m = line.match(/- \*\*(.+?)\*\* \[(\w+)\]: (.+?)(?:\s*\(.*\))?$/);
      if (m) {
        augmentOptions.push({
          name: m[1],
          tier: m[2],
          description: m[3].trim(),
        });
      }
    }
  }

  return { question, history, augmentOptions };
}

function parseItems(
  userPrompt: string,
  pattern: RegExp
): Array<{ name: string; description: string }> {
  const match = userPrompt.match(pattern);
  if (!match) return [];
  return match[1]
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const content = l.replace(/^- /, "");
      const colonIdx = content.indexOf(": ");
      if (colonIdx >= 0) {
        return {
          name: content.substring(0, colonIdx).trim(),
          description: content.substring(colonIdx + 2).trim(),
        };
      }
      return { name: content.trim(), description: "" };
    });
}

function buildLabel(
  header: Record<string, string>,
  context: ExtractedFixture["context"]
): string {
  const question = header["Question"] ?? "";
  const time = `${Math.floor(context.gameTime / 60)}:${String(context.gameTime % 60).padStart(2, "0")}`;
  const champ = context.champion.name;

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
