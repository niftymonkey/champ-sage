/**
 * State Awareness scorer for the coaching eval pipeline.
 *
 * Gate scorer: checks that the model references relevant game state
 * information when the fixture's scorerHints indicate it should.
 * Returns 0 if a required reference is missing, 1 if all are present.
 */

export type StateAwarenessRule =
  | "grievous-wounds"
  | "mr-needed"
  | "enemy-comp"
  | "existing-items";

const GRIEVOUS_WOUNDS_KEYWORDS = [
  "grievous wounds",
  "anti-heal",
  "antiheal",
  "morellonomicon",
  "thornmail",
  "oblivion orb",
  "chempunk",
  "chainsword",
];

const MR_KEYWORDS = [
  "magic resist",
  " mr ",
  " mr.",
  " mr,",
  "spirit visage",
  "force of nature",
  "banshee's veil",
  "banshee's",
  "abyssal mask",
  "wit's end",
  "maw of malmortius",
  "malmortius",
  "hollow radiance",
  "kaenic rookern",
];

// Damage profile keywords that show the model acknowledged the enemy comp
const COMP_AWARENESS_KEYWORDS = [
  " ap ",
  " ad ",
  "magic damage",
  "physical damage",
  "ap-heavy",
  "ad-heavy",
  "ap heavy",
  "ad heavy",
  "all ap",
  "all ad",
  "mostly ap",
  "mostly ad",
];

function hasKeyword(lower: string, keywords: string[]): boolean {
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Check whether a coaching response demonstrates awareness of the game state.
 *
 * Each rule in `hints` maps to a set of keywords that should appear in the
 * response. All rules must pass for a score of 1. Any failure yields 0.
 *
 * Returns 1.0 if no hints are provided (not a state-awareness fixture).
 */
export function scoreStateAwareness(
  response: string,
  hints: StateAwarenessRule[] | undefined,
  items: string[],
  enemyChampions?: string[]
): number {
  if (!hints || hints.length === 0) return 1;

  const lower = response.toLowerCase();

  for (const rule of hints) {
    switch (rule) {
      case "grievous-wounds":
        if (!hasKeyword(lower, GRIEVOUS_WOUNDS_KEYWORDS)) return 0;
        break;

      case "mr-needed":
        if (!hasKeyword(lower, MR_KEYWORDS)) return 0;
        break;

      case "enemy-comp": {
        // Check if response mentions any enemy champion or a damage profile keyword
        const mentionsEnemy = enemyChampions?.some((name) =>
          lower.includes(name.toLowerCase())
        );
        const mentionsProfile = hasKeyword(lower, COMP_AWARENESS_KEYWORDS);
        if (!mentionsEnemy && !mentionsProfile) return 0;
        break;
      }

      case "existing-items": {
        // Check if response references any of the player's owned items
        if (items.length === 0) break; // nothing to check
        const mentionsItem = items.some(
          (item) => item.length > 3 && lower.includes(item.toLowerCase())
        );
        if (!mentionsItem) return 0;
        break;
      }
    }
  }

  return 1;
}
