import { useEffect, useState } from "react";
import { postGameReady$ } from "../lib/reactive/post-game-readiness";

/**
 * Mirrors the `postGameReady$` subject into React state. `false` while
 * a game just ended and the surface is waiting for fresh in-memory
 * data; `true` otherwise (steady state OR snapshot refreshed since the
 * end transition).
 */
export function usePostGameReady(): boolean {
  const [ready, setReady] = useState(postGameReady$.getValue());
  useEffect(() => {
    const sub = postGameReady$.subscribe(setReady);
    return () => sub.unsubscribe();
  }, []);
  return ready;
}
