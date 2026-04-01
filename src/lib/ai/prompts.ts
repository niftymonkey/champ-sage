import type { CoachingContext, CoachingQuery } from "./types";
import { formatGameTime } from "../format";
import { GAME_MODE_MAYHEM, GAME_MODE_ARAM } from "../mode/types";

export function buildSystemPrompt(context: {
  gameMode: string;
  lcuGameMode: string;
  hasAugmentOptions?: boolean;
}): string {
  const sections = [
    "You are an expert League of Legends coaching AI. Prioritize the game data provided in this prompt over your general knowledge — item stats, augment effects, and champion abilities change frequently.",
    "",
    "ITEM AWARENESS: Do not recommend purchasing items already listed in the player's inventory.",
    "GOLD AWARENESS: The gold amount shown is the player's exact current gold. Use it to determine what they can afford. Do not hedge with 'if you can buy' when the gold amount is visible.",
    "ITEM RECOMMENDATIONS: Always name the full target item you're building toward AND the immediate component to buy. Example: 'Build toward Rabadon's Deathcap — buy Needlessly Large Rod next (1250g).' Players think in terms of completed items, not components.",
    "",
    "RESPONSE RULES:",
    "- Be extremely concise. Sacrifice grammar for concision.",
    "- Lead with your top recommendation. Mention alternatives only when the situation genuinely supports different playstyles.",
    "- Never explain what the player already knows.",
  ];

  const isMayhem =
    context.lcuGameMode === GAME_MODE_MAYHEM ||
    context.gameMode === GAME_MODE_MAYHEM ||
    context.gameMode === GAME_MODE_ARAM;

  // Only include augment rules when the player is actually choosing augments
  if (isMayhem && context.hasAugmentOptions) {
    sections.push(
      "",
      "AUGMENT SELECTION RULES:",
      "- Augments are NOT items. They are permanent passive bonuses.",
      "- 3 cards shown, each with its own single-use re-roll button.",
      "- Round 1: Recommend the best card. Tell player to re-roll the other two.",
      "- Round 2: 2 new cards replace the re-rolled ones. Only the kept card still has its re-roll.",
      "  - If a new card is better: re-roll the kept card (its re-roll is still unused).",
      "  - If the kept card is still best: take it. No re-rolls remain on the others.",
      "- Round 3 (only if kept card was re-rolled): Pick the best of the 3 final cards. No re-rolls remain.",
      "- A card whose re-roll was used CANNOT be re-rolled again.",
      "- If an augment upgrades a specific item, only recommend it if the player already owns that item.",
      "- Use the augment descriptions provided in the prompt, not your general knowledge."
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
  sections.push(
    `Game Mode: ${modeLabel} | Game Time: ${formatGameTime(context.gameTime)}`
  );

  const statProfile = context.champion.statProfile
    ? ` | ${context.champion.statProfile}`
    : "";
  sections.push(
    `Champion: ${context.champion.name} | Level ${context.champion.level} | KDA: ${context.kda.kills}/${context.kda.deaths}/${context.kda.assists}${statProfile}`
  );

  if (context.champion.abilities) {
    sections.push(`### Abilities\n${context.champion.abilities}`);
  }

  if (context.balanceOverrides) {
    sections.push(`### Balance Overrides\n${context.balanceOverrides}`);
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
    const meaningful = query.history.filter(
      (e) => !/^i (?:chose|picked|took|selected|went with) /i.test(e.question)
    );
    if (meaningful.length > 0) {
      const recent = meaningful.slice(-4);
      sections.push("## Recent Conversation");
      for (const exchange of recent) {
        sections.push(`Q: ${exchange.question}`);
        sections.push(`A: ${exchange.answer}`);
      }
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

  // Items co-located with the question so the model can't miss them
  if (context.currentItems.length > 0) {
    const itemNames = context.currentItems.map((i) => i.name).join(", ");
    sections.push(
      `## Question\nItems you own: ${itemNames} (${Math.floor(context.currentGold)} gold available)\n${query.question}`
    );
  } else {
    sections.push(
      `## Question\n${Math.floor(context.currentGold)} gold available, no items yet.\n${query.question}`
    );
  }

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
