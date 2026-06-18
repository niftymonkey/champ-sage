/**
 * Pure parsing of the collector's `--modes` CLI flag.
 *
 * `--modes aram,arena` or `--modes=ranked-solo` restricts a run to specific
 * queue modes, so a finished mode (e.g. ARAM already collected) can be skipped
 * and the rest collected without waiting for it to drain. Absent flag means
 * "all modes", signalled by returning null so the caller keeps its default.
 */
export function parseModesArg<T extends string>(
  argv: string[],
  validModes: readonly T[]
): T[] | null {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--modes") {
      raw = argv[i + 1];
      break;
    }
    if (arg.startsWith("--modes=")) {
      raw = arg.slice("--modes=".length);
      break;
    }
  }
  if (raw == null) return null;

  const valid = new Set<string>(validModes);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => valid.has(s)) as T[];
}
