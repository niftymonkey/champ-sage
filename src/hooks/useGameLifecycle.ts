import { useState, useEffect } from "react";
import type { GameLifecycleEvent } from "../lib/reactive";
import { gameLifecycle$ } from "../lib/reactive";

export function useGameLifecycle(): GameLifecycleEvent {
  const [state, setState] = useState<GameLifecycleEvent>(
    gameLifecycle$.getValue()
  );

  useEffect(() => {
    const sub = gameLifecycle$.subscribe(setState);
    return () => sub.unsubscribe();
  }, []);

  return state;
}
