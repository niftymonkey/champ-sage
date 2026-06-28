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
    let pushed = false;
    // Subscribe first so any live push wins, then pull the verdict already
    // computed at package-ready (it can fire before this renderer mounts).
    // The pull only applies when no push has landed yet, so a slow-resolving
    // snapshot can never overwrite a newer pushed verdict.
    const unsubscribe = api.onGepHealth((v) => {
      if (cancelled) return;
      pushed = true;
      setVerdict(v);
    });
    api
      .getGepHealth?.()
      .then((v) => {
        if (!cancelled && !pushed && v) setVerdict(v);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return verdict;
}
