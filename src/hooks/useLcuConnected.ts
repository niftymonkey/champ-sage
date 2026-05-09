import { useEffect, useState } from "react";
import { lcuCredentials$ } from "../lib/reactive";

/**
 * Mirrors the reactive `lcuCredentials$` subject into React state so
 * surfaces can render LCU-aware copy (e.g. "League client offline" vs
 * "No matches yet") without subscribing inline. `true` while creds are
 * present; `false` while the engine reports the LCU as offline.
 */
export function useLcuConnected(): boolean {
  const [connected, setConnected] = useState<boolean>(
    lcuCredentials$.getValue() !== null
  );
  useEffect(() => {
    const sub = lcuCredentials$.subscribe((c) => setConnected(c !== null));
    return () => sub.unsubscribe();
  }, []);
  return connected;
}
