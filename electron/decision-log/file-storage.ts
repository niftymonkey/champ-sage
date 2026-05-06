import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DecisionStorage } from "./storage";
import type {
  DecisionRecord,
  RecoveryWarning,
} from "../../src/lib/decision-log/types";

interface IndexFile {
  games: Array<{ gameId: string; firstSentAt: number }>;
}

const INDEX_FILE = "index.json";

/**
 * File-backed adapter — append-only NDJSON files per game under `dir`,
 * plus an `index.json` that records games in chronological order of their
 * first append. The index is the cheap source for "recent games" without
 * scanning the filesystem.
 *
 * Layout:
 *   <dir>/index.json                  — { games: [{ gameId, firstSentAt }] }
 *   <dir>/<gameId>.ndjson             — one record per line
 *
 * Recovery: at hydrate time, malformed lines are dropped silently and
 * surfaced via `warnings`. A truncated final line (process killed
 * mid-write) is the common case and recovers cleanly. If `index.json` is
 * missing or unparseable, the directory is scanned for `.ndjson` files
 * and a fresh index is rebuilt from the first record of each.
 */
export function createFileStorage(dir: string): DecisionStorage {
  let closed = false;

  const ensureDir = (): void => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  };

  const ensureOpen = (op: string): void => {
    if (closed) throw new Error(`DecisionStorage closed (during ${op})`);
  };

  const indexPath = (): string => join(dir, INDEX_FILE);
  const gamePath = (gameId: string): string => join(dir, `${gameId}.ndjson`);

  const readIndex = (): IndexFile | null => {
    if (!existsSync(indexPath())) return null;
    try {
      const raw = readFileSync(indexPath(), "utf-8");
      const parsed = JSON.parse(raw) as IndexFile;
      if (!parsed || !Array.isArray(parsed.games)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeIndex = (data: IndexFile): void => {
    ensureDir();
    writeFileSync(indexPath(), JSON.stringify(data, null, 2), "utf-8");
  };

  const parseGameFile = (
    gameId: string
  ): { records: DecisionRecord[]; droppedLines: number } => {
    const path = gamePath(gameId);
    if (!existsSync(path)) return { records: [], droppedLines: 0 };
    const raw = readFileSync(path, "utf-8");
    const lines = raw.split("\n");
    const records: DecisionRecord[] = [];
    let droppedLines = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        records.push(JSON.parse(line) as DecisionRecord);
      } catch {
        droppedLines += 1;
      }
    }
    return { records, droppedLines };
  };

  const rebuildIndexFromFiles = (): IndexFile => {
    if (!existsSync(dir)) return { games: [] };
    const files = readdirSync(dir).filter((name) => name.endsWith(".ndjson"));
    const games: IndexFile["games"] = [];
    for (const file of files) {
      const gameId = file.replace(/\.ndjson$/, "");
      const { records } = parseGameFile(gameId);
      const first = records[0];
      if (first) games.push({ gameId, firstSentAt: first.sentAt });
    }
    games.sort((a, b) => a.firstSentAt - b.firstSentAt);
    return { games };
  };

  return {
    async hydrate() {
      ensureOpen("hydrate");
      ensureDir();
      let index = readIndex();
      if (index === null) {
        index = rebuildIndexFromFiles();
        if (index.games.length > 0) writeIndex(index);
      }

      const games: Array<{ gameId: string; records: DecisionRecord[] }> = [];
      const warnings: RecoveryWarning[] = [];
      for (const entry of index.games) {
        const { records, droppedLines } = parseGameFile(entry.gameId);
        games.push({ gameId: entry.gameId, records });
        if (droppedLines > 0) {
          warnings.push({
            gameId: entry.gameId,
            droppedLines,
            reason: "malformed lines skipped during hydrate",
          });
        }
      }
      return { games, warnings };
    },

    async appendRecord(record) {
      ensureOpen("appendRecord");
      ensureDir();
      appendFileSync(
        gamePath(record.gameId),
        `${JSON.stringify(record)}\n`,
        "utf-8"
      );
      const current = readIndex() ?? { games: [] };
      const exists = current.games.some((g) => g.gameId === record.gameId);
      if (!exists) {
        current.games.push({
          gameId: record.gameId,
          firstSentAt: record.sentAt,
        });
        writeIndex(current);
      }
    },

    async loadGame(gameId) {
      ensureOpen("loadGame");
      const path = gamePath(gameId);
      if (!existsSync(path)) return null;
      const { records } = parseGameFile(gameId);
      return records;
    },

    async close() {
      closed = true;
    },
  };
}
