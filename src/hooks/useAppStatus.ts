import { useEffect, useState } from "react";
import { appStatus$, mainStatus$ } from "../lib/reactive/streams";
import type { SubsystemStatus } from "../lib/app-status";

/**
 * Starts feeding `mainStatus$` from the main process. Call once, as high in the
 * tree as possible.
 *
 * Subscribe-then-pull, for the same reason `useGepHealth` does it: almost every
 * status is set during boot, which is over before the first renderer mounts, so
 * the pull is the path that actually delivers most of them. Subscribing first
 * means a push that lands mid-pull is not lost, and the pull refuses to
 * overwrite a push that already arrived.
 */
export function useMainStatusBridge(): void {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppStatus) return;

    let cancelled = false;
    let pushed = false;
    const unsubscribe = api.onAppStatus((all) => {
      if (cancelled) return;
      pushed = true;
      mainStatus$.next(all);
    });
    api
      .getAppStatus?.()
      .then((all) => {
        // An empty pull is an answer, not a non-answer: it means the main
        // process has nothing wrong to report. Skipping it would leave a stale
        // banner up across a bridge remount that a healthy main cannot clear.
        if (!cancelled && !pushed && all) mainStatus$.next(all);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}

/**
 * Everything wrong with the app right now, worst first, from both processes.
 *
 * Read-only: reporting goes through `mainStatus$` (via the bridge above) or
 * `localStatus$` (for renderer-only failures).
 */
export function useAppStatus(): SubsystemStatus[] {
  const [statuses, setStatuses] = useState<SubsystemStatus[]>([]);

  useEffect(() => {
    const sub = appStatus$.subscribe(setStatuses);
    return () => sub.unsubscribe();
  }, []);

  return statuses;
}
