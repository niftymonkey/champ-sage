/**
 * Map DDragon's `tags` array (e.g. ["Marksman", "Assassin"]) to one of
 * the four class slots the v16 palette covers.
 *
 * DDragon returns tags ordered primary-first (Malphite is ["Tank","Mage"],
 * Lux is ["Mage","Support"]), so we trust Riot's ordering and read
 * `tags[0]` only. An earlier priority-list approach in EnemyStrip
 * walked the array and prioritised Fighter/Assassin over Mage, which
 * mislabelled AP-leaning fighters/assassins like Mordekaiser, Akali,
 * Diana — and disagreed with ChampSelectSurface on the same champion.
 *
 * Shared so the in-game enemy strip and the champ-select grid stay in
 * agreement.
 */
export type ChampionClassTag = "ad" | "ap" | "tank" | "supp";

export function primaryClassTag(tags: string[]): ChampionClassTag | null {
  const k = tags[0]?.toLowerCase();
  if (!k) return null;
  if (k === "marksman" || k === "fighter" || k === "assassin") return "ad";
  if (k === "mage") return "ap";
  if (k === "tank") return "tank";
  if (k === "support") return "supp";
  return null;
}

export function classTagLabel(tag: ChampionClassTag): string {
  switch (tag) {
    case "ad":
      return "AD";
    case "ap":
      return "AP";
    case "tank":
      return "Tank";
    case "supp":
      return "Supp";
  }
}
