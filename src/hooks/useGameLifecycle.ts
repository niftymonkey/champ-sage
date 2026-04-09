import { useState, useEffect, useRef } from "react";
import type { GameLifecycleEvent } from "../lib/reactive";
import type { GameflowPhase } from "../lib/reactive/types";
import { gameLifecycle$, liveGameState$ } from "../lib/reactive";
import { resolveChampionName } from "../lib/data-ingest/champion-id-map";
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  merge,
} from "rxjs";

/**
 * Subscribe to game lifecycle events.
 *
 * Phase events are delivered immediately (they're the source of truth).
 * Non-phase events (lobby, session, matchmaking) are debounced to prevent
 * flickering during rapid state transitions.
 */
const DEBOUNCE_MS = 400;

/** Extract the local player's champion name from raw champ select session data. */
function getLocalChampionName(champSelect: unknown): string | null {
  if (champSelect == null || typeof champSelect !== "object") return null;
  const cs = champSelect as Record<string, unknown>;
  const localCellId = cs.localPlayerCellId as number | undefined;
  const myTeam = cs.myTeam as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(myTeam)) return null;
  const local = myTeam.find((m) => m.cellId === localCellId);
  if (!local) return null;
  const lockedId = local.championId as number;
  if (lockedId > 0) return resolveChampionName(lockedId) ?? null;
  const hoverId = local.championPickIntent as number;
  if (hoverId > 0) return resolveChampionName(hoverId) ?? null;
  return null;
}

export function useGameLifecycle(): {
  event: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
  championName: string | null;
} {
  const [event, setEvent] = useState<GameLifecycleEvent>(
    gameLifecycle$.getValue()
  );
  const lastPhaseRef = useRef<GameflowPhase | null>(null);
  const [lastPhase, setLastPhase] = useState<GameflowPhase | null>(null);
  const [championName, setChampionName] = useState<string | null>(null);

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

    const lifecycleSub = merge(immediate$, debounced$).subscribe((e) => {
      if (e.type === "phase") {
        lastPhaseRef.current = e.phase;
        setLastPhase(e.phase);
      }
      setEvent(e);
    });

    // Derive champion name when either phase or champ select data changes
    const phase$ = gameLifecycle$.pipe(
      filter((e) => e.type === "phase"),
      map((e) => (e as { type: "phase"; phase: GameflowPhase }).phase)
    );
    const championSub = combineLatest([phase$, liveGameState$])
      .pipe(
        map(([phase, state]) =>
          phase === "ChampSelect"
            ? getLocalChampionName(state.champSelect)
            : null
        ),
        distinctUntilChanged()
      )
      .subscribe(setChampionName);

    return () => {
      lifecycleSub.unsubscribe();
      championSub.unsubscribe();
    };
  }, []);

  return { event, lastPhase, championName };
}
