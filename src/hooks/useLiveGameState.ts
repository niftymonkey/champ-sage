import { useState, useEffect } from "react";
import type { LiveGameState } from "../lib/reactive";
import { liveGameState$ } from "../lib/reactive";

export function useLiveGameState(): LiveGameState {
  const [state, setState] = useState<LiveGameState>(liveGameState$.getValue());

  useEffect(() => {
    const sub = liveGameState$.subscribe(setState);
    return () => sub.unsubscribe();
  }, []);

  return state;
}
