import { useEffect, useRef, useState } from "react";
import { useGameLifecycle } from "../hooks/useGameLifecycle";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { resolveSurface, type Surface } from "./resolveSurface";

interface UseSurfaceStateResult {
  surface: Surface;
  navigate: (next: Surface) => void;
}

/**
 * Resolve which top-level surface the renderer should show, with respect for
 * the user's last manual nav click.
 *
 * Override-expiry rule: a manual nav click sticks until the *auto-resolved*
 * default surface would change underneath it. Small in-game events (ChampSelect
 * updates, polling ticks) do not pull the user back; a real lifecycle
 * transition (game ends, champ-select starts) does. Phrased as user
 * experience: "your click is good until the game does something that changes
 * which screen you'd normally be on."
 */
export function useSurfaceState(): UseSurfaceStateResult {
  const { lastPhase } = useGameLifecycle();
  const liveGame = useLiveGameState();
  const hasActivePlayer = liveGame.activePlayer !== null;

  const [override, setOverride] = useState<Surface | null>(null);

  // Latches once a real in-game-ish phase has been seen this session.
  // Until then, post-game phases auto-route to idle so a fresh launch
  // doesn't strand the user on History when the LCU is still reporting
  // EndOfGame from the previous match.
  const seenInGameRef = useRef(false);
  if (
    lastPhase === "ChampSelect" ||
    lastPhase === "GameStart" ||
    lastPhase === "InProgress" ||
    hasActivePlayer
  ) {
    seenInGameRef.current = true;
  }

  const autoSurface = resolveSurface({
    phase: lastPhase,
    hasActivePlayer,
    manualOverride: null,
    hasSeenInGamePhase: seenInGameRef.current,
  });

  // Track the prior auto-resolved surface so we can detect a "real" change.
  // When the auto default flips, the override is stale by definition - the
  // user's click no longer corresponds to the screen they would otherwise be
  // looking at, so it expires.
  const prevAutoRef = useRef(autoSurface);
  useEffect(() => {
    if (prevAutoRef.current !== autoSurface) {
      prevAutoRef.current = autoSurface;
      setOverride(null);
    }
  }, [autoSurface]);

  const surface = resolveSurface({
    phase: lastPhase,
    hasActivePlayer,
    manualOverride: override,
    hasSeenInGamePhase: seenInGameRef.current,
  });

  return { surface, navigate: setOverride };
}
