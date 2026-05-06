/**
 * Display-name mapping for game-mode strings.
 *
 * The Live Client Data API returns "KIWI" for ARAM Mayhem and other
 * cryptic codes for various modes; the LCU's match-history endpoint
 * varies. The renderer wants human-readable labels in the eyebrow,
 * recent-games row, and any other spot a mode shows up.
 *
 * Centralized here so the same label appears everywhere — fixes the
 * "Loss / Kiwi" vs "Win / Mayhem" mixed-signal bug we hit when each
 * surface formatted modes independently.
 */
export function formatGameMode(raw: string | null | undefined): string {
  if (!raw) return "—";
  const upper = raw.toUpperCase();
  if (upper === "KIWI" || upper === "MAYHEM") return "MAYHEM";
  if (upper === "ARAM") return "ARAM";
  if (upper === "CLASSIC" || upper === "SUMMONERS_RIFT") return "CLASSIC";
  if (upper === "CHERRY" || upper === "ARENA") return "CHERRY";
  if (upper === "PRACTICETOOL") return "PRACTICETOOL";
  return upper;
}
