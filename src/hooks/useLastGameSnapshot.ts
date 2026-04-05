import { useState, useEffect } from "react";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import { lastGameSnapshot$ } from "../lib/reactive/coaching-feed";

export function useLastGameSnapshot(): LastGameSnapshot | null {
  const [snapshot, setSnapshot] = useState<LastGameSnapshot | null>(
    lastGameSnapshot$.getValue()
  );

  useEffect(() => {
    const sub = lastGameSnapshot$.subscribe(setSnapshot);
    return () => sub.unsubscribe();
  }, []);

  return snapshot;
}
