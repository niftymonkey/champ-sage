/**
 * Pure formatting for the meta-build collector's live progress display.
 *
 * No I/O: `scripts/fetch-meta-builds.ts` owns the terminal writes (carriage
 * returns and ANSI cursor moves); this module only builds the strings, so the
 * human-facing output can be unit-tested without running the collector.
 */

/** Thousands-separated integer for human-facing counts (e.g. `7,234`). */
export function fmtN(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** A fixed-width progress bar like `▕████████░░░░░░░░▏`. */
export function progressBar(fraction: number, width = 16): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return `▕${"█".repeat(filled)}${"░".repeat(width - filled)}▏`;
}

/** Render `fraction` as a right-aligned percentage like `" 48%"` or `"100%"`. */
export function pctLabel(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  return `${Math.floor(clamped * 100)}%`.padStart(4);
}

export interface SnowballProgress {
  /** Matches collected inside the current freshness window. */
  inWindowCount: number;
  /** Total matches cached for this queue (accumulates across runs). */
  totalMatches: number;
  /** Players whose match lists have been pulled this pass. */
  playersChecked: number;
  /** Players still queued for discovery, summed across both queue tiers. */
  queueSize: number;
  /** Rolling new-matches-per-query rate; trends to zero near saturation. */
  recentMatchesPerQuery: number;
}

/**
 * The two-line live block for snowball collection (ARAM, Arena). There is no
 * per-window target anymore: collection drains one wide window every run, so
 * the display shows collected counts and the rolling new-per-query rate (the
 * real "near done" signal as it trends to zero) rather than a percent-to-target
 * bar. The discovery queue is presented as context: it grows as matches reveal
 * new players and shrinks as the frontier is drained.
 */
export function snowballProgressLines(p: SnowballProgress): string[] {
  return [
    `  collecting · ${fmtN(p.inWindowCount)} fresh matches in window`,
    `   ${fmtN(p.totalMatches)} total · ${fmtN(
      p.playersChecked
    )} players checked · ~${fmtN(p.queueSize)} pending · ${p.recentMatchesPerQuery.toFixed(
      1
    )} new/query`,
  ];
}

export interface BarProgress {
  /** Units completed (against a known total). */
  done: number;
  /** Total units; the bar is `done / total`. */
  total: number;
  /** Noun for the counted units, e.g. `"match details fetched"`. */
  label: string;
  /** Secondary context line shown beneath the bar. */
  subtitle: string;
}

/**
 * A generic two-line bar block for phases with a known denominator (the ranked
 * match-id and match-detail passes), so they read consistently with the
 * snowball block.
 */
export function barProgressLines(p: BarProgress): string[] {
  const fraction = p.total > 0 ? p.done / p.total : 0;
  return [
    `  ${pctLabel(fraction)} ${progressBar(fraction)}  ${fmtN(p.done)} / ${fmtN(
      p.total
    )} ${p.label}`,
    `   ${p.subtitle}`,
  ];
}
