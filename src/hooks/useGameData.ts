import { useState, useEffect, useCallback } from "react";
import { loadGameData, type LoadedGameData } from "../lib/data-ingest";

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
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
