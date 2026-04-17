import type { GameMode } from "../mode/types";
import type { LoadedGameData } from "../data-ingest";
import type { AramOverrides, Champion } from "../data-ingest/types";
import type { GameState } from "../game-state/types";
import { formatModifier } from "../format";
import { GAME_MODE_MAYHEM, GAME_MODE_ARAM } from "../mode/types";
import { buildItemCatalogSections } from "./item-catalog";

const ITEM_RECOMMENDATIONS_RULE =
  "ITEM RECOMMENDATIONS: When recommending an item purchase, always name the destination (completed) item AND a buildable component. If the player can afford a component: 'Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now.' If not: 'Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod at 1250g.' Name the most expensive component the player can currently afford. If no component is affordable, name the cheapest and its gold threshold. Never recommend unrelated filler items just to spend gold. For non-purchase responses (strategy, positioning, augments), just name items naturally without this format.";

/**
 * Build a comprehensive system prompt for a multi-turn game session.
 *
 * Contains everything that doesn't change mid-game: coaching rules, static
 * game data (champion abilities, base stats, runes), all 10 champion names
 * and tags, mode-specific rules, and balance overrides.
 *
 * Uses the GameMode interface for all conditional logic — no hardcoded
 * mode strings.
 */
export function buildGameSystemPrompt(
  mode: GameMode,
  gameData: LoadedGameData,
  gameState: GameState
): string {
  const sections: string[] = [];

  // --- Coaching persona and rules ---
  sections.push(
    "You are an expert League of Legends coaching AI. Prioritize the game data provided in this prompt over your general knowledge — item stats, augment effects, and champion abilities change frequently."
  );
  sections.push("");
  sections.push(
    "ITEM AWARENESS: Do not recommend purchasing items already listed in the player's inventory. Only recommend items that exist in the Item Catalog sections below — if a name does not appear there, it is NOT a purchasable item. Augments listed in the player's state are passive bonuses, not items — never recommend an augment name as an item to buy."
  );
  sections.push(
    "GOLD AWARENESS: The gold amount shown is the player's exact current gold. Use it to determine what they can afford. Do not hedge with 'if you can buy' when the gold amount is visible."
  );
  sections.push(ITEM_RECOMMENDATIONS_RULE);
  sections.push("");
  sections.push("RESPONSE RULES:");
  sections.push(
    "- Respond in 1-3 sentences maximum. Shorter is always better — the player is mid-game. Sacrifice grammar for brevity."
  );
  sections.push(
    "- Lead with your top recommendation. Mention alternatives only when the situation genuinely supports different playstyles."
  );
  sections.push("- Never explain what the player already knows.");

  // --- State snapshot format instructions ---
  sections.push("");
  sections.push(
    "CONVERSATION FORMAT: Each question will be preceded by a [Game State] block showing the current state of the game. This snapshot is authoritative — use it as ground truth for your recommendations."
  );

  // --- Opportunistic coaching ---
  sections.push("");
  sections.push(
    "PROACTIVE AWARENESS: Before answering any item question, check the enemy team composition. If the enemy has heavy healing (Soraka, Aatrox, Yuumi, Warwick, Dr. Mundo), mention grievous wounds. If 3+ enemies deal magic damage, mention magic resist. If you notice other build gaps (missing resistances, unusually high unspent gold), flag them briefly."
  );
  sections.push("");
  sections.push(
    "ITEM POOL USAGE: When an item pool is provided for the player's champion, treat it as a curated set of viable items — NOT as a build order or a list to regurgitate. Choose items from the pool that specifically counter the enemy team composition and address the player's current game state. Different matchups should produce different recommendations from the same pool. If the enemy comp or game state calls for something outside the pool (grievous wounds, specific defensive items, matchup counters), recommend from the broader available items instead — do not restrict yourself to the pool."
  );

  // --- Augment rules (conditional on mode) ---
  if (mode.decisionTypes.includes("augment-selection")) {
    sections.push("");
    sections.push("AUGMENT FIT RATING:");
    sections.push(
      "- Augments are NOT items. They are permanent passive bonuses."
    );
    sections.push(
      "- Rate each offered augment independently using the `fit` field: exceptional, strong, situational, or weak. Ties are expected — two augments can both be strong, or all three can be weak."
    );
    sections.push(
      "- ALWAYS return all offered augments in the recommendations array, each with its own fit rating and reasoning. The UI renders a badge on every card."
    );
    sections.push(
      "- Fit tiers (default to strong or situational — most augments are one of these):"
    );
    sections.push(
      "  - exceptional: RARE. Only for augments that unlock a multiplicative synergy the player's existing build is already set up to exploit — e.g. Dual Wield when they already have 3+ on-hit items, or a percent-HP augment on a champion stacking health items. If the augment is simply 'good for this champion', that is strong, not exceptional. Expect fewer than 1 in 10 offers to contain an exceptional augment."
    );
    sections.push(
      "  - strong: Good fit for the current champion, build, and game state. This is the correct rating for augments that align well with the champion's kit or build direction."
    );
    sections.push(
      "  - situational: Conditional value — could pay off depending on how the game develops, decent but not ideal, or has a prerequisite that isn't fully met yet."
    );
    sections.push(
      "  - weak: Poor fit for the current state. Explain briefly why."
    );
    sections.push(
      "- Reasoning describes what the augment does and why it fits (or doesn't) the current state. No imperative language — do not say 'pick this', 'take this', or 'reroll that'."
    );
    sections.push(
      "- If an augment upgrades a specific item, only rate it strong/exceptional if the player already owns that item."
    );
    sections.push(
      "- Use the augment descriptions provided in the prompt, not your general knowledge."
    );
    sections.push("");
    sections.push("SYNERGY COACHING:");
    sections.push(
      "- Look for unconventional build paths enabled by augment, set bonus, item, and stat anvil synergies. An AD champion with a tank augment like Goliath might pivot into a Heartsteel build. A mage with attack speed augments might go on-hit."
    );
    sections.push(
      "- When an augment or set bonus changes what items are optimal, recommend the synergy build and explain WHY it works — the player needs to understand the reasoning, not just the pick."
    );
    sections.push(
      "- Don't default to cookie-cutter builds. ARAM Mayhem rewards creative synergies that wouldn't work in standard modes."
    );
  }

  // --- Game mode ---
  sections.push("");
  sections.push(`GAME MODE: ${mode.displayName}`);

  // --- Player champion static data ---
  if (gameState.activePlayer) {
    const championKey = gameState.activePlayer.championName.toLowerCase();
    const champion = gameData.champions.get(championKey);

    sections.push("");
    sections.push("## Player Champion");

    if (champion) {
      sections.push(formatChampionProfile(champion));

      if (champion.abilities) {
        sections.push("");
        sections.push("### Abilities");
        sections.push(formatAbilitiesForPrompt(champion.abilities));
      }

      // Balance overrides — included when the mode handles ARAM-family games
      const isAramFamily =
        mode.matches(GAME_MODE_ARAM) || mode.matches(GAME_MODE_MAYHEM);
      if (champion.aramOverrides && isAramFamily) {
        const overrides = formatBalanceOverridesForPrompt(
          champion.aramOverrides
        );
        if (overrides) {
          sections.push("");
          sections.push(`### Balance Overrides\n${overrides}`);
        }
      }
    } else {
      sections.push(
        `${gameState.activePlayer.championName} (no champion data available)`
      );
    }

    // Runes
    const runes = gameState.activePlayer.runes;
    sections.push("");
    sections.push(
      `Runes: ${runes.keystone} (${runes.primaryTree} / ${runes.secondaryTree})`
    );

    // --- Item catalog (tier 1: meta-derived, tier 2: mode-valid fallback) ---
    // Reuse the `champion` resolved above rather than re-looking it up.
    const itemCatalog = buildItemCatalogSections(
      mode,
      champion,
      gameData.items,
      gameData.metaBuilds
    );
    if (itemCatalog.text) {
      sections.push("");
      sections.push(itemCatalog.text);
    }
  }

  // --- All champions in the match ---
  if (gameState.players.length > 0) {
    sections.push("");
    sections.push("## Match Roster");

    const activeTeam =
      gameState.players.find((p) => p.isActivePlayer)?.team ?? "ORDER";

    const allies = gameState.players.filter((p) => p.team === activeTeam);
    const enemies = gameState.players.filter((p) => p.team !== activeTeam);

    if (allies.length > 0) {
      const allyList = allies
        .map((p) => {
          const champ = gameData.champions.get(p.championName.toLowerCase());
          const tags = champ?.tags.join("/") ?? "unknown";
          return `${p.championName} (${tags})`;
        })
        .join(", ");
      sections.push(`Ally Team: ${allyList}`);
    }

    if (enemies.length > 0) {
      const enemyList = enemies
        .map((p) => {
          const champ = gameData.champions.get(p.championName.toLowerCase());
          const tags = champ?.tags.join("/") ?? "unknown";
          return `${p.championName} (${tags})`;
        })
        .join(", ");
      sections.push(`Enemy Team: ${enemyList}`);
    }
  }

  return sections.join("\n");
}

function formatChampionProfile(champion: Champion): string {
  const s = champion.stats;
  const rangeType =
    s.attackrange <= 300 ? "Melee" : `Ranged (${s.attackrange})`;

  return [
    `${champion.name} — ${champion.title}`,
    `${rangeType} | ${champion.tags.join(", ")} | ${champion.partype || "No resource"}`,
  ].join("\n");
}

function formatAbilitiesForPrompt(
  abilities: NonNullable<Champion["abilities"]>
): string {
  const parts: string[] = [];
  parts.push(
    `Passive: ${abilities.passive.name} — ${abilities.passive.description}`
  );
  for (const spell of abilities.spells) {
    parts.push(`${spell.name} — ${spell.description}`);
  }
  return parts.join("\n");
}

function formatBalanceOverridesForPrompt(
  overrides: AramOverrides
): string | null {
  const parts: string[] = [];
  if (overrides.dmgDealt !== 1) {
    parts.push(`Damage dealt: ${formatModifier(overrides.dmgDealt)}`);
  }
  if (overrides.dmgTaken !== 1) {
    parts.push(`Damage taken: ${formatModifier(overrides.dmgTaken)}`);
  }
  if (overrides.healing != null && overrides.healing !== 1) {
    parts.push(`Healing: ${formatModifier(overrides.healing)}`);
  }
  if (overrides.shielding != null && overrides.shielding !== 1) {
    parts.push(`Shielding: ${formatModifier(overrides.shielding)}`);
  }
  if (overrides.tenacity != null && overrides.tenacity !== 1) {
    parts.push(`Tenacity: ${formatModifier(overrides.tenacity)}`);
  }
  if (overrides.abilityHaste != null && overrides.abilityHaste !== 0) {
    parts.push(`Ability Haste: +${overrides.abilityHaste}`);
  }
  if (parts.length === 0) return null;
  return parts.join(", ");
}
