import { useState, useEffect, useRef } from "react";
import type { GameLifecycleEvent } from "../lib/reactive";
import type { GameflowPhase } from "../lib/reactive/types";
import { gameLifecycle$ } from "../lib/reactive";
import { debounceTime, filter, merge } from "rxjs";

/**
 * Subscribe to game lifecycle events.
 *
 * Phase events are delivered immediately (they're the source of truth).
 * Non-phase events (lobby, session, matchmaking) are debounced to prevent
 * flickering during rapid state transitions.
 */
const DEBOUNCE_MS = 400;

export function useGameLifecycle(): {
  event: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
} {
  const [event, setEvent] = useState<GameLifecycleEvent>(
    gameLifecycle$.getValue()
  );
  const lastPhaseRef = useRef<GameflowPhase | null>(null);
  const [lastPhase, setLastPhase] = useState<GameflowPhase | null>(null);

  useEffect(() => {
    // Phase and connection events: deliver immediately
    const immediate$ = gameLifecycle$.pipe(
      filter((e) => e.type === "phase" || e.type === "connection")
    );

    // Non-phase events: debounce to avoid flicker
    const debounced$ = gameLifecycle$.pipe(
      filter((e) => e.type !== "phase" && e.type !== "connection"),
      debounceTime(DEBOUNCE_MS)
    );

    const sub = merge(immediate$, debounced$).subscribe((e) => {
      if (e.type === "phase") {
        lastPhaseRef.current = e.phase;
        setLastPhase(e.phase);
      }
      setEvent(e);
    });

    return () => sub.unsubscribe();
  }, []);

  return { event, lastPhase };
}
