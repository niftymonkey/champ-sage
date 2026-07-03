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
 * never renders a blank. Names are used for image alt text and accessibility;
 * the UI shows icons, not these strings.
 */
export function resolveSummonerSpellName(spellId: number): string {
  return SUMMONER_SPELL_NAMES[spellId] ?? `Spell ${spellId}`;
}

const DDRAGON_BASE = "https://ddragon.leagueoflegends.com";

/**
 * Data Dragon image filename per summoner-spell ID. Verified against
 * `summoner.json`; these have been stable for years. The numeric IDs come from
 * Match-v5/LCU; Data Dragon keys its spell icons by these filenames, not by ID,
 * so the mapping is explicit.
 */
const SUMMONER_SPELL_ICON_FILES: Record<number, string> = {
  1: "SummonerBoost.png",
  3: "SummonerExhaust.png",
  4: "SummonerFlash.png",
  6: "SummonerHaste.png",
  7: "SummonerHeal.png",
  11: "SummonerSmite.png",
  12: "SummonerTeleport.png",
  13: "SummonerMana.png",
  14: "SummonerDot.png",
  21: "SummonerBarrier.png",
  32: "SummonerSnowball.png",
};

/**
 * Build the Data Dragon icon URL for a summoner-spell ID at the given game-data
 * version (the same CDN and version the app uses for champion and item images).
 * Returns an empty string for an unknown ID so callers can fall back to text.
 */
export function summonerSpellIconUrl(spellId: number, version: string): string {
  const file = SUMMONER_SPELL_ICON_FILES[spellId];
  return file ? `${DDRAGON_BASE}/cdn/${version}/img/spell/${file}` : "";
}
