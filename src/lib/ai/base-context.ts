import type { GameMode } from "../mode/types";
import type { LoadedGameData } from "../data-ingest";
import type {
  AbilitySpell,
  AramOverrides,
  Champion,
} from "../data-ingest/types";
import type { GameState } from "../game-state/types";
import { formatModifier } from "../format";
import { GAME_MODE_MAYHEM, GAME_MODE_ARAM } from "../mode/types";
import { buildItemCatalogSections } from "./item-catalog";

export interface BaseContextInputs {
  readonly mode: GameMode;
  readonly gameData: LoadedGameData;
  readonly gameState: GameState;
}

/**
 * Feature-agnostic base context for the system prompt.
 *
 * Everything that doesn't change per LLM call and isn't owned by a specific
 * feature: coaching persona, response brevity, state-snapshot format
 * explainer, mode name, champion profile + abilities + runes, item catalog,
 * and match roster. Feature-specific rule blocks (augment fit, item
 * recommendation format, proactive awareness, etc.) live in
 * `buildFeatureRules` and eventually in each feature's task prompt.
 */
export function buildBaseContext(inputs: BaseContextInputs): string {
  const { mode, gameData, gameState } = inputs;
  const sections: string[] = [];

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

  sections.push("");
  sections.push(
    "CONVERSATION FORMAT: Each question will be preceded by a [Game State] block showing the current state of the game. This snapshot is authoritative — use it as ground truth for your recommendations."
  );

  sections.push("");
  sections.push(`GAME MODE: ${mode.displayName}`);

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

    // Mayhem has no runes (the Live Client reports them empty), so the line
    // would always render as "Runes:  ( / )". Regular ARAM does have runes.
    if (!mode.matches(GAME_MODE_MAYHEM)) {
      const runes = gameState.activePlayer.runes;
      sections.push("");
      sections.push(
        `Runes: ${runes.keystone} (${runes.primaryTree} / ${runes.secondaryTree})`
      );
    }

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

const SPELL_SLOTS = ["Q", "W", "E", "R"] as const;

/**
 * Collapse a per-rank value series for the prompt. Ranks that share one value
 * (a flat 7s cooldown) render as a single number; ranks that vary keep the
 * full series, because the ramp is the decision-relevant part. A series that
 * is uniformly zero carries no information and renders as nothing.
 */
function formatRankSeries(values: readonly number[]): string | null {
  if (values.length === 0) return null;
  const unique = [...new Set(values)];
  if (unique.length === 1) {
    return unique[0] === 0 ? null : String(unique[0]);
  }
  return values.join("/");
}

/**
 * Render one spell's numbers as a compact bracketed suffix. Values that carry
 * no information (a zero-cost ability, a self-cast with no range) are omitted
 * rather than printed as "0", which would read as a real number to the model.
 *
 * Wiki-sourced scaling ("Damage Per Pass: 35 to 135 (+ 50% AP)") joins the same
 * bracket. Only stats that parsed cleanly reach here, so a spell the wiki could
 * not be trusted on simply renders its cooldown and cost as before.
 */
function formatSpellNumbers(spell: AbilitySpell): string {
  const cooldown = formatRankSeries(spell.cooldowns);
  const cost = formatRankSeries(spell.costs);
  const range = formatRankSeries(spell.range);

  const parts: string[] = [];
  if (cooldown) parts.push(`CD ${cooldown}s`);
  if (cost) parts.push(`cost ${cost}`);
  if (range) parts.push(`range ${range}`);
  for (const stat of spell.scaling ?? []) {
    parts.push(`${stat.label}: ${stat.value}`);
  }

  return parts.length > 0 ? ` [${parts.join(" | ")}]` : "";
}

function formatAbilitiesForPrompt(
  abilities: NonNullable<Champion["abilities"]>
): string {
  const parts: string[] = [];
  parts.push(
    `Passive: ${abilities.passive.name} — ${abilities.passive.description}`
  );
  abilities.spells.forEach((spell, index) => {
    const slot = SPELL_SLOTS[index] ?? `S${index + 1}`;
    parts.push(
      `${slot} - ${spell.name}: ${spell.description}${formatSpellNumbers(spell)}`
    );
  });
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
