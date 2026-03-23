import type { CoachingContext, CoachingQuery } from "./types";

export function buildSystemPrompt(): string {
  return [
    "You are a League of Legends coaching AI.",
    "Be blunt and decisive — give a clear answer, not hedged analysis.",
    "Consider the full game context when answering:",
    "- Champion abilities and playstyle",
    "- Current items and build path",
    "- Existing augments and synergies (in augment modes)",
    "- Enemy team composition and threats",
    "- Ally team composition and synergies",
    "- Game mode and its specific dynamics",
    "- Game time and power spikes",
    "",
    "If the player asks about choosing between options (augments, items, etc.),",
    "rank them from best to worst and explain why.",
    "If the player asks an open-ended question, give actionable advice.",
    "Keep answers concise — players are mid-game and need fast answers.",
  ].join("\n");
}

export function buildUserPrompt(
  context: CoachingContext,
  query: CoachingQuery
): string {
  const sections: string[] = [];

  sections.push(`## Game Mode: ${context.gameMode}`);
  sections.push(
    `## Game Time: ${Math.floor(context.gameTime / 60)}:${String(Math.floor(context.gameTime % 60)).padStart(2, "0")}`
  );

  sections.push(
    `## Your Champion: ${context.champion.name} (Level ${context.champion.level})`
  );
  if (context.champion.abilities) {
    sections.push(`### Abilities\n${context.champion.abilities}`);
  }

  if (context.balanceOverrides) {
    sections.push(`### Balance Overrides\n${context.balanceOverrides}`);
  }

  if (context.currentItems.length > 0) {
    sections.push(`### Current Items\n${context.currentItems.join(", ")}`);
  } else {
    sections.push("### Current Items\nNone");
  }

  if (context.currentAugments.length > 0) {
    sections.push(
      `### Current Augments\n${context.currentAugments.join(", ")}`
    );
  }

  if (context.allyTeam.length > 0) {
    const allies = context.allyTeam.map((a) => `- ${a.champion}`).join("\n");
    sections.push(`### Ally Team\n${allies}`);
  }

  if (context.enemyTeam.length > 0) {
    const enemies = context.enemyTeam
      .map((e) => `- ${e.champion}: ${e.items.join(", ") || "No items"}`)
      .join("\n");
    sections.push(`### Enemy Team\n${enemies}`);
  }

  // Conversation history
  if (query.history && query.history.length > 0) {
    sections.push("## Recent Conversation");
    for (const exchange of query.history) {
      sections.push(`**Player:** ${exchange.question}`);
      sections.push(`**Coach:** ${exchange.answer}`);
    }
  }

  // Augment options if this is an augment selection question
  if (query.augmentOptions && query.augmentOptions.length > 0) {
    sections.push("## Augment Options");
    for (const option of query.augmentOptions) {
      let line = `- **${option.name}** [${option.tier}]: ${option.description}`;
      if (option.sets && option.sets.length > 0) {
        line += ` (Sets: ${option.sets.join(", ")})`;
      }
      sections.push(line);
    }
  }

  sections.push(`## Question\n${query.question}`);

  return sections.join("\n\n");
}
