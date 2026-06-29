/**
 * Summoner-spell ID to display-name map.
 *
 * Riot's Match-v5 and LCU APIs identify summoner spells by numeric ID. There is
 * no display-name source wired into the app yet (Data Dragon `summoner.json`
 * exists but isn't ingested), so the ARAM-eligible set is hardcoded here. This
 * covers every spell that can appear in ARAM/Mayhem meta data: the standard
 * Summoner's Rift kit plus Mark (32), the ARAM snowball spell. Wire Data Dragon
 * in later only if a mode surfaces a spell outside this set.
 */

const SUMMONER_SPELL_NAMES: Record<number, string> = {
  1: "Cleanse",
  3: "Exhaust",
  4: "Flash",
  6: "Ghost",
  7: "Heal",
  11: "Smite",
  12: "Teleport",
  13: "Clarity",
  14: "Ignite",
  21: "Barrier",
  32: "Mark",
};

/**
 * Resolve a summoner-spell ID to its display name, falling back to a stable
 * `Spell <id>` label for any ID outside the known ARAM-eligible set so the UI
 * never renders a blank.
 */
export function resolveSummonerSpellName(spellId: number): string {
  return SUMMONER_SPELL_NAMES[spellId] ?? `Spell ${spellId}`;
}
