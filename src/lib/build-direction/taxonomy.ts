/**
 * Build-direction taxonomy — single source of truth for the vocabulary
 * used by the player-declared picker, the enemy-inference pipeline,
 * the strip UI, and coaching prompts.
 *
 * Starts at the 4-value DDragon-aligned set. Widening the enum later
 * (e.g. splitting AD into ad-bruiser / ad-assassin / ad-marksman) is
 * cheap; narrowing it once features depend on the rich values is not.
 */

export type BuildDirection = "ad" | "ap" | "tank" | "supp";

export type ConfidenceLevel = "stereotype" | "low" | "high";

export const ALL_DIRECTIONS: readonly BuildDirection[] = [
  "ad",
  "ap",
  "tank",
  "supp",
];

const LABELS: Record<BuildDirection, string> = {
  ad: "AD",
  ap: "AP",
  tank: "Tank",
  supp: "Support",
};

export function label(direction: BuildDirection): string {
  return LABELS[direction];
}

/**
 * Map a DDragon `tags[0]` value to a build-direction stereotype. Mirrors
 * the priority decision documented on the previous champion-class helper:
 * trust DDragon's primary-first ordering rather than re-prioritising
 * tags ourselves.
 */
export function stereotypeFromClassTag(
  ddragonTag: string | undefined
): BuildDirection | null {
  const t = ddragonTag?.toLowerCase();
  if (!t) return null;
  if (t === "marksman" || t === "fighter" || t === "assassin") return "ad";
  if (t === "mage") return "ap";
  if (t === "tank") return "tank";
  if (t === "support") return "supp";
  return null;
}
