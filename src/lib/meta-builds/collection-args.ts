/**
 * Pure parsing of the collector's `--modes` CLI flag.
 *
 * `--modes aram,arena` or `--modes=ranked-solo` restricts a run to specific
 * queue modes, so a finished mode (e.g. ARAM already collected) can be skipped
 * and the rest collected without waiting for it to drain. Absent flag means
 * "all modes", signalled by returning null so the caller keeps its default.
 *
 * A present-but-empty `--modes` (no value, or `--modes=`) returns [] instead:
 * the user meant to restrict modes but named none, so run nothing rather than
 * silently running every mode (the heaviest operation). Duplicates are removed.
 */
export function parseModesArg<T extends string>(
  argv: string[],
  validModes: readonly T[]
): T[] | null {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--modes") {
      // No following token (or another flag) means "--modes" was given without
      // a value. Treat that as "restrict to nothing", not "absent" (the absent
      // case is handled below by raw staying undefined).
      const next = argv[i + 1];
      raw = next === undefined ? "" : next;
      break;
    }
    if (arg.startsWith("--modes=")) {
      raw = arg.slice("--modes=".length);
      break;
    }
  }
  if (raw == null) return null;

  const valid = new Set<string>(validModes);
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => valid.has(s)) as T[];
  return [...new Set(parsed)];
}
