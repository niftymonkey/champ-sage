import { useState, useEffect, useCallback } from "react";
import { loadGameData, type LoadedGameData } from "../lib/data-ingest";
import { populateChampionIdMap } from "../lib/data-ingest/champion-id-map";
import { getLogger } from "../lib/logger";

const dataLog = getLogger("data-ingest");

interface UseGameDataResult {
  data: LoadedGameData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGameData(): UseGameDataResult {
  const [data, setData] = useState<LoadedGameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    loadGameData()
      .then((result) => {
        populateChampionIdMap(result.champions);
        dataLog.info(
          `Data loaded: ${result.champions.size} champions, ${result.items.size} items, ${result.augments.size} augments (v${result.version})`
        );
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        dataLog.error(`Data ingest failed: ${msg}`);
        setError(msg);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
