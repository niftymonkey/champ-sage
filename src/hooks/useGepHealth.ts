import { useEffect, useState } from "react";
import type { GepHealthVerdict } from "../lib/gep-health";

/**
 * Subscribes to the GEP pre-queue health verdict the main process emits when
 * the GEP package loads. Holds the latest verdict so a banner can warn the
 * player before they queue when augment coaching will be silently unavailable.
 * No-op (stays null) outside ow-electron, where the IPC channel does not exist.
 */
export function useGepHealth(): GepHealthVerdict | null {
  const [verdict, setVerdict] = useState<GepHealthVerdict | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onGepHealth) return;

    let cancelled = false;
    // Pull the verdict already computed at package-ready (it can fire before
    // this renderer mounts), then subscribe for any later updates.
    api
      .getGepHealth?.()
      .then((v) => {
        if (!cancelled && v) setVerdict(v);
      })
      .catch(() => {});
    const unsubscribe = api.onGepHealth(setVerdict);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return verdict;
}
