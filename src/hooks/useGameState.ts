import { useState, useEffect, useRef } from "react";
import { GameStateManager, type GameState } from "../lib/game-state";

const POLL_INTERVAL_MS = 2000;

export function useGameState(): GameState {
  const managerRef = useRef<GameStateManager | null>(null);

  if (managerRef.current === null) {
    managerRef.current = new GameStateManager();
  }

  const [state, setState] = useState<GameState>(managerRef.current.getState());

  useEffect(() => {
    const manager = managerRef.current!;
    const unsubscribe = manager.subscribe(setState);
    manager.start(POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      manager.stop();
    };
  }, []);

  return state;
}
