import type { AbilitySpell } from "../data-ingest/types";

const SPELL_SLOTS = ["Q", "W", "E", "R"] as const;

/**
 * The exact ratio token the wiki scaling renderer emits inside stat values,
 * e.g. "(+ 90% AP)" or "(+ 100% bonus AD)". Strict by design: a value that
 * does not match contributes nothing, because a lenient parse would fold
 * shapes like "(+ 4% per 100 AP)" into a flat ratio and misstate the kit.
 */
const RATIO_TOKEN = /\(\+ (\d+(?:\.\d+)?)% ([A-Za-z][A-Za-z ]*?)\)/g;

/** Best ratio one ability converts a stat at, plus how it should render. */
interface AbilityRatio {
  slot: string;
  ratio: number;
  /** How many ratio tokens collapsed into this max, for "up to" rendering. */
  collapsed: number;
  /** Utility parenthetical like "(shield)" when the max ratio is defensive. */
  marker: string | null;
}

/**
 * Derive the "Scaling profile:" summary line from a kit's per-ability scaling
 * stats, or null when no ratio parses anywhere.
 *
 * The model otherwise has to assemble "this champion converts AP into damage
 * and shields at high ratios" from up to eight bracket fragments mid-decision;
 * this line states it once, deterministically, from data already in the
 * prompt. Ratios group by verbatim stat name, each ability contributing its
 * highest ratio per stat ("up to" marks a collapse of several). Absent AP or
 * AD coverage is stated explicitly because those are the stats augments most
 * commonly grant, and their absence is as decision-relevant as any positive
 * ratio. The passive never contributes: its numbers are prose, not structured
 * stats.
 */
export function deriveScalingProfile(
  spells: readonly AbilitySpell[]
): string | null {
  const byStat = new Map<string, Map<string, AbilityRatio>>();

  spells.forEach((spell, index) => {
    const slot = SPELL_SLOTS[index] ?? `S${index + 1}`;
    for (const stat of spell.scaling ?? []) {
      for (const match of stat.value.matchAll(RATIO_TOKEN)) {
        const ratio = Number(match[1]);
        const perSlot = byStat.get(match[2]) ?? new Map<string, AbilityRatio>();
        byStat.set(match[2], perSlot);

        const existing = perSlot.get(slot);
        if (!existing) {
          perSlot.set(slot, {
            slot,
            ratio,
            collapsed: 1,
            marker: utilityMarker(stat.label),
          });
          continue;
        }
        existing.collapsed++;
        if (ratio > existing.ratio) {
          existing.ratio = ratio;
          existing.marker = utilityMarker(stat.label);
        }
      }
    }
  });

  if (byStat.size === 0) return null;

  const sentences: string[] = [];
  for (const [statName, perSlot] of byStat) {
    const entries = [...perSlot.values()].map((entry) => {
      const prefix = entry.collapsed > 1 ? "up to " : "";
      const marker = entry.marker ? ` ${entry.marker}` : "";
      return `${entry.slot} ${prefix}${entry.ratio}%${marker}`;
    });
    sentences.push(`${statName} - ${entries.join(", ")}.`);
  }

  const statNames = [...byStat.keys()];
  if (!statNames.some((name) => /\bAP\b/.test(name))) {
    sentences.push("No AP ratios.");
  }
  if (!statNames.some((name) => /\bAD\b/.test(name))) {
    sentences.push("No AD ratios.");
  }

  return `Scaling profile: ${sentences.join(" ")}`;
}

function utilityMarker(label: string): string | null {
  if (/shield/i.test(label)) return "(shield)";
  if (/heal/i.test(label)) return "(heal)";
  return null;
}
