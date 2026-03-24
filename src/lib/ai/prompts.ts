import type { CoachingContext, CoachingQuery } from "./types";

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
    context.lcuGameMode === "KIWI" || context.gameMode === "ARAM";
  if (isMayhem) {
    sections.push(
      "",
      "ARAM MAYHEM AUGMENT RULES (this is ARAM Mayhem mode, not regular ARAM):",
      "- In Mayhem, players are offered 3 augment choices at levels 1, 7, 11, and 15.",
      "- Augments are NOT items. They are permanent passive bonuses chosen from a curated set.",
      "- Augment names can overlap with item names. Always check the Augment Options section below for the actual augment descriptions before assuming the player is talking about an item.",
      "- When the player lists 3 options separated by commas or 'or', they are asking you to choose between augment offers.",
      "- RE-ROLL RULES (strict two-phase process):",
      "  PHASE 1: Player presents 3 augments. You respond: 'Keep [best]. Re-roll the other two.'",
      "  PHASE 2: Player reports the re-roll results (2 new augments + the 1 kept from Phase 1).",
      "    - The KEPT augment from Phase 1 CANNOT be re-rolled again — it is locked in.",
      "    - You can ONLY choose between the 3 options as they are now.",
      "    - Pick the best of the 3 and tell the player to take it.",
      "    - Do NOT say 're-roll' in Phase 2 — there are no more re-rolls.",
      '  Example Phase 1: "Keep Demon\'s Dance, re-roll the other two."',
      "  Example Phase 2: \"Take Demon's Dance — it's still the best option.\"",
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
    const itemLines = context.currentItems.map((item) =>
      item.description
        ? `- ${item.name}: ${item.description}`
        : `- ${item.name}`
    );
    sections.push(`### Current Items\n${itemLines.join("\n")}`);
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
      .map(
        (e) =>
          `- ${e.champion}: ${e.items.map((i) => i.name).join(", ") || "No items"}`
      )
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

  // Augment options if detected
  if (query.augmentOptions && query.augmentOptions.length > 0) {
    sections.push("## Augment Options Being Offered");
    sections.push("The player is choosing between these augments (NOT items):");
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
