import type { CoachingContext, CoachingQuery } from "./types";
import { formatGameTime } from "../format";
import { GAME_MODE_MAYHEM, GAME_MODE_ARAM } from "../mode/types";

export function buildSystemPrompt(context: {
  gameMode: string;
  lcuGameMode: string;
}): string {
  const sections = [
    "You are a League of Legends coaching AI. The player is mid-game — they need answers FAST.",
    "",
    "Consider the full game context when reasoning:",
    "- Champion abilities and playstyle",
    "- Current items and build path",
    "- Existing augments and synergies (in augment modes)",
    "- Enemy team composition and threats",
    "- Ally team composition and synergies",
    "- Game mode and its specific dynamics",
    "- Game time and power spikes",
    "",
    "RESPONSE LENGTH RULES (strict):",
    "- 1-2 sentences for simple questions (what to buy, which augment).",
    "- 3-4 bullet points max for tactical questions (when to roam, how to play a matchup).",
    "- Never write paragraphs. Never explain what the player already knows.",
    "- Be blunt. Give THE answer, not a menu of options with hedging.",
    "- Only list alternatives if the player specifically asks for options.",
  ];

  const isMayhem =
    context.lcuGameMode === GAME_MODE_MAYHEM ||
    context.gameMode === GAME_MODE_MAYHEM ||
    context.gameMode === GAME_MODE_ARAM;
  if (isMayhem) {
    sections.push(
      "",
      "ARAM MAYHEM AUGMENT RULES (this is ARAM Mayhem mode, not regular ARAM):",
      "- In Mayhem, players are offered 3 augment choices at levels 1, 7, 11, and 15.",
      "- Augments are NOT items. They are permanent passive bonuses chosen from a curated set.",
      "- Augment names can overlap with item names. Always check the Augment Options section below for the actual augment descriptions before assuming the player is talking about an item.",
      "- When the player lists 3 options separated by commas or 'or', they are asking you to choose between augment offers.",
      "- RE-ROLL RULES: Each of the 3 augment cards has its own independent re-roll (one use each).",
      "  ROUND 1: Player shows 3 augments. Pick the best, tell them to re-roll the other two.",
      "  ROUND 2: Player reports 2 new augments. You now have 3 cards: the kept one + 2 new ones.",
      "    - If a new one beats the kept one: tell them to re-roll the kept one (its re-roll is still unused).",
      "    - If the kept one is still best: tell them to take it. No re-rolls left on the other two.",
      "  ROUND 3 (only if Round 2 re-rolled the kept one): Player reports 1 new augment.",
      "    - Now pick the best of the 3 final cards. No more re-rolls exist.",
      "  KEY: The player may only report the NEW cards. Remember which one was kept from prior rounds.",
      "- When recommending an augment, consider: champion synergy, current build path, existing augments, and enemy team.",
      "- CRITICAL: If an augment upgrades a specific item (like 'Upgrade Collector'), only recommend it if the player already owns that item OR is planning to build it. If they don't have the item and aren't building it, the augment is wasted.",
      "- If an Augment Options section with descriptions appears below, use those descriptions — they are the exact in-game effects."
    );
  }

  return sections.join("\n");
}

export function buildUserPrompt(
  context: CoachingContext,
  query: CoachingQuery
): string {
  const sections: string[] = [];

  const modeLabel =
    context.lcuGameMode && context.lcuGameMode !== context.gameMode
      ? `${context.gameMode} — ${context.lcuGameMode === GAME_MODE_MAYHEM ? "Mayhem (KIWI)" : context.lcuGameMode}`
      : context.gameMode;
  sections.push(`## Game Mode: ${modeLabel}`);
  sections.push(`## Game Time: ${formatGameTime(context.gameTime)}`);

  sections.push(
    `## Your Champion: ${context.champion.name} (Level ${context.champion.level}, ${context.kda.kills}/${context.kda.deaths}/${context.kda.assists} KDA)`
  );
  if (context.champion.statProfile) {
    sections.push(`### Stat Profile\n${context.champion.statProfile}`);
  }

  if (context.champion.abilities) {
    sections.push(`### Abilities\n${context.champion.abilities}`);
  }

  if (context.balanceOverrides) {
    sections.push(`### Balance Overrides\n${context.balanceOverrides}`);
  }

  if (context.currentItems.length > 0) {
    const itemLines = context.currentItems.map((item) =>
      item.description
        ? `- ${item.name}: ${item.description}`
        : `- ${item.name}`
    );
    sections.push(
      `### Current Items (${context.currentGold} gold available)\n${itemLines.join("\n")}`
    );
  } else {
    sections.push(
      `### Current Items (${context.currentGold} gold available)\nNone`
    );
  }

  if (context.currentAugments.length > 0) {
    const augmentLines = context.currentAugments.map((aug) =>
      aug.description ? `- ${aug.name}: ${aug.description}` : `- ${aug.name}`
    );
    sections.push(`### Current Augments\n${augmentLines.join("\n")}`);

    const setProgress = computeSetProgress(
      context.currentAugments,
      context.augmentSets
    );
    if (setProgress) {
      sections.push(`### Augment Set Progress\n${setProgress}`);
    }
  }

  if (context.teamAnalysis) {
    sections.push(`### Team Analysis\n${context.teamAnalysis}`);
  }

  if (context.allyTeam.length > 0) {
    const allies = context.allyTeam.map((a) => `- ${a.champion}`).join("\n");
    sections.push(`### Ally Team\n${allies}`);
  }

  if (context.enemyTeam.length > 0) {
    const enemies = context.enemyTeam
      .map(
        (e) =>
          `- ${e.champion}: ${e.items.map((i) => i.name).join(", ") || "No items"}`
      )
      .join("\n");
    sections.push(`### Enemy Team\n${enemies}`);
  }

  if (query.history && query.history.length > 0) {
    sections.push("## Recent Conversation");
    for (const exchange of query.history) {
      sections.push(`**Player:** ${exchange.question}`);
      sections.push(`**Coach:** ${exchange.answer}`);
    }
  }

  if (query.augmentOptions && query.augmentOptions.length > 0) {
    sections.push("## Augment Options Being Offered");
    sections.push("The player is choosing between these augments (NOT items):");

    const setCounts = countSets(context.currentAugments);

    for (const option of query.augmentOptions) {
      let line = `- **${option.name}** [${option.tier}]: ${option.description}`;
      if (option.sets && option.sets.length > 0) {
        const setAnnotations = option.sets.map((setName) => {
          const current = setCounts.get(setName) ?? 0;
          const wouldHave = current + 1;
          const setDef = context.augmentSets.find((s) => s.name === setName);
          const activatedBonus = setDef?.bonuses.find(
            (b) => b.threshold === wouldHave
          );
          if (activatedBonus) {
            return `${setName} ${wouldHave}/${maxThreshold(setDef!)} — UNLOCKS: ${activatedBonus.description}`;
          }
          const nextBonus = setDef?.bonuses.find(
            (b) => b.threshold > wouldHave
          );
          if (nextBonus) {
            return `${setName} ${wouldHave}/${nextBonus.threshold}`;
          }
          return setName;
        });
        line += ` (${setAnnotations.join("; ")})`;
      }
      sections.push(line);
    }
  }

  sections.push(`## Question\n${query.question}`);

  return sections.join("\n\n");
}

/** Count how many chosen augments the player has in each set */
function countSets(
  augments: CoachingContext["currentAugments"]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const aug of augments) {
    if (aug.sets) {
      for (const setName of aug.sets) {
        counts.set(setName, (counts.get(setName) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Get the highest bonus threshold for a set */
function maxThreshold(set: CoachingContext["augmentSets"][number]): number {
  if (set.bonuses.length === 0) return 0;
  return Math.max(...set.bonuses.map((b) => b.threshold));
}

/**
 * Build a set progress summary showing active bonuses and next thresholds.
 * Returns null if the player has no augments in any tracked set.
 */
function computeSetProgress(
  augments: CoachingContext["currentAugments"],
  augmentSets: CoachingContext["augmentSets"]
): string | null {
  const setCounts = countSets(augments);
  if (setCounts.size === 0) return null;

  const lines: string[] = [];
  for (const [setName, count] of setCounts) {
    const setDef = augmentSets.find((s) => s.name === setName);
    if (!setDef) continue;

    const max = maxThreshold(setDef);
    // Find active bonuses (thresholds met)
    const active = setDef.bonuses.filter((b) => b.threshold <= count);
    // Find next bonus threshold
    const next = setDef.bonuses.find((b) => b.threshold > count);

    let line = `- ${setName} (${count}/${next?.threshold ?? max})`;
    if (active.length > 0) {
      const latest = active[active.length - 1];
      line += ` — Active: ${latest.description}`;
    }
    if (next) {
      line += ` — Next at ${next.threshold}: ${next.description}`;
    }
    lines.push(line);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
