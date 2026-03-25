/** Format game time in seconds to M:SS */
export function formatGameTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Format a multiplier (e.g., 1.05) as a percentage string (e.g., "+5%") */
export function formatModifier(value: number): string {
  const pct = Math.round((value - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}
