import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AugmentBadges } from "./AugmentBadges";
import type { CoachingResponse } from "../lib/ai/types";
import { getLogger } from "../lib/logger";

const overlayLog = getLogger("overlay");

/** Enable calibration grid + F8 screenshots via VITE_DEBUG_OVERLAY=1 */
const DEBUG_OVERLAY = import.meta.env.VITE_DEBUG_OVERLAY === "1";

/**
 * Safety timeout — if no coaching response arrives, stop showing "Analyzing".
 * Sized to cover one LLM call plus a silent retry on schema parse failure (#102).
 * Worst case: attempt 1 fails late (~12s) and attempt 2 needs ~10-12s, so give
 * 25s of headroom before the overlay gives up and clears the cards.
 */
const ANALYZING_TIMEOUT_MS = 25_000;

/**
 * Root component for the overlay window. Renders augment badges and
 * coaching strip on top of the game. All content is click-through
 * by default; holding Tab enters edit mode for repositioning.
 */
export function OverlayApp() {
  const [coachingData, setCoachingData] = useState<CoachingResponse | null>(
    null
  );
  const [augmentOffer, setAugmentOffer] = useState<string[] | null>(null);

  // Track which offer the coaching response should match.
  // When a new offer arrives, we increment the ID. When a response arrives,
  // we only apply it if it was requested for the current offer.
  const offerIdRef = useRef(0);
  const offerNamesRef = useRef<string[] | null>(null);
  const analyzingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for edit mode toggle (Tab hotkey)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onOverlayEditMode) return;

    const unlisten = api.onOverlayEditMode(({ editing: isEditing }) => {
      overlayLog.info(`Edit mode: ${isEditing ? "ON" : "OFF"}`);
    });

    return () => unlisten();
  }, []);

  // Clear augment state when the game exits — prevents stale badges
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onOverlayStatus) return;

    const unlisten = api.onOverlayStatus((payload: unknown) => {
      const status = payload as { active?: boolean };
      if (status.active === false) {
        overlayLog.info("Game exited — clearing augment overlay state");
        setAugmentOffer(null);
        setCoachingData(null);
        if (analyzingTimerRef.current) {
          clearTimeout(analyzingTimerRef.current);
          analyzingTimerRef.current = null;
        }
        window.electronAPI?.requestOverlayFlush("badge");
      }
    });

    return () => unlisten();
  }, []);

  // Force a paint by toggling a compositor-layer property on the overlay
  // root across two animation frames. The Overwolf passthrough compositor
  // often coalesces DOM mutations and skips paints; promoting and releasing
  // a compositor layer routes through the same paint path as a real DOM
  // change. Call after any state transition that changes what should be
  // visible. (#98)
  //
  // Pairs with `requestOverlayFlush` for state-hidden transitions — the
  // React-side nudge alone isn't enough to dislodge the last-painted
  // frame from ow-electron's compositor; the main-process flush
  // (`forceCompositorFlush` in electron/main.ts) is what actually
  // guarantees the window repaints when offer/coaching go back to null
  // (#111).
  const forcePaintNudge = useCallback(() => {
    requestAnimationFrame(() => {
      const root = document.getElementById("overlay-root");
      if (!root) return;
      root.style.transform = "translateZ(0)";
      requestAnimationFrame(() => {
        root.style.transform = "";
      });
    });
  }, []);

  const requestMainFlush = useCallback(() => {
    window.electronAPI?.requestOverlayFlush("badge");
  }, []);

  // Manual clear from app window or hotkey (#111 safety valve). Resets
  // state to the hidden baseline and nudges the compositor. Main process
  // already triggers `forceCompositorFlush` on broadcast of this IPC, so
  // the renderer only needs the React-side state reset + paint nudge.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onClearOverlays) return;

    const unlisten = api.onClearOverlays(() => {
      overlayLog.info("Clear overlays — resetting badge state");
      offerNamesRef.current = null;
      setAugmentOffer(null);
      setCoachingData(null);
      if (analyzingTimerRef.current) {
        clearTimeout(analyzingTimerRef.current);
        analyzingTimerRef.current = null;
      }
      forcePaintNudge();
    });

    return () => unlisten();
  }, [forcePaintNudge]);

  // Listen for coaching responses relayed from desktop window
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCoachingResponse) return;

    const unlisten = api.onCoachingResponse((data: unknown) => {
      const response = data as CoachingResponse & { source?: string };

      // Only display augment responses — reactive (voice) responses go to coaching strip
      if (response.source !== "augment") return;

      const sentAt = (response as unknown as { sentAt?: number }).sentAt;
      const delay = sentAt ? Date.now() - sentAt : null;
      const recNames = response.recommendations?.map(
        (r: { name: string }) => r.name
      );

      overlayLog.info(
        `Augment coaching received (${delay}ms delay, recs: ${recNames?.join(", ")})`
      );

      // Discard responses that arrive after the player already picked.
      // The abort signal races with the response — if the pick cleared
      // the offer before this fires, applying it would show stale badges.
      const currentOfferNames = offerNamesRef.current;
      if (!currentOfferNames) {
        overlayLog.info(
          "Discarding stale coaching response — offer already cleared by pick"
        );
        return;
      }

      // Also discard if the response was for a previous offer: fast pick →
      // new offer arrives → stale response from the prior offer finally lands.
      // offerNamesRef is now non-null but points to the new offer, so we need
      // to check the response actually matches the current augment names.
      const currentOfferNameSet = new Set(
        currentOfferNames.map((n) => n.toLowerCase())
      );
      const matchesCurrentOffer =
        response.recommendations?.length === currentOfferNames.length &&
        response.recommendations.every((r) =>
          currentOfferNameSet.has(r.name.toLowerCase())
        );
      if (!matchesCurrentOffer) {
        overlayLog.info(
          "Discarding stale coaching response — recommendations do not match current offer"
        );
        return;
      }

      if (analyzingTimerRef.current) {
        clearTimeout(analyzingTimerRef.current);
        analyzingTimerRef.current = null;
      }

      setCoachingData(response);
      forcePaintNudge();
    });

    return () => unlisten();
  }, [forcePaintNudge]);

  // Listen for augment offers from GEP
  const handleAugmentOffer = useCallback(
    (names: string[]) => {
      // Skip if the offer payload is identical to the current one. GEP can
      // fire duplicate events that differ only at the object level (same
      // augment names, different refs). Nulling coaching data on these
      // creates state churn and spurious re-renders for no user-visible
      // change. (#98)
      const prev = offerNamesRef.current;
      if (
        prev &&
        prev.length === names.length &&
        prev.every((n, i) => n === names[i])
      ) {
        overlayLog.debug(
          `Augment offer identical to current (${names.join(", ")}) — skipping state update`
        );
        return;
      }

      overlayLog.info(`Augment offer received: ${names.join(", ")}`);
      offerIdRef.current += 1;
      offerNamesRef.current = names;
      setAugmentOffer(names);
      forcePaintNudge();

      // Safety timeout — stop showing "Analyzing" if coaching never arrives
      if (analyzingTimerRef.current) clearTimeout(analyzingTimerRef.current);
      analyzingTimerRef.current = setTimeout(() => {
        overlayLog.warn(
          `Analyzing timeout after ${ANALYZING_TIMEOUT_MS}ms — no coaching response, hiding badges`
        );
        setAugmentOffer(null);
        setCoachingData(null);
        forcePaintNudge();
        requestMainFlush();
      }, ANALYZING_TIMEOUT_MS);
    },
    [forcePaintNudge, requestMainFlush]
  );

  const handleAugmentPicked = useCallback(() => {
    overlayLog.info("Augment picked — clearing offer and coaching data");
    offerNamesRef.current = null;
    setAugmentOffer(null);
    setCoachingData(null);
    if (analyzingTimerRef.current) {
      clearTimeout(analyzingTimerRef.current);
      analyzingTimerRef.current = null;
    }
    forcePaintNudge();
    requestMainFlush();
  }, [forcePaintNudge, requestMainFlush]);

  // Log state changes for debugging stale badge issues.
  // This is what determines whether "Analyzing" or actual badges render —
  // offer != null && coaching == null → "Analyzing" boxes shown
  // offer != null && coaching != null → ranked badges shown
  useEffect(() => {
    const showing = augmentOffer
      ? coachingData
        ? "badges"
        : "analyzing"
      : "hidden";
    overlayLog.info(
      `Badge render state: ${showing} (offer=${augmentOffer?.length ?? "none"}, coaching=${coachingData ? "yes" : "none"})`
    );
  }, [augmentOffer, coachingData]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (analyzingTimerRef.current) clearTimeout(analyzingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onGepInfoUpdate) return;

    let lastOfferKey = "";

    const unlisten = api.onGepInfoUpdate((payload: unknown) => {
      const update = payload as {
        feature?: string;
        key?: string;
        value?: string;
      };

      if (update.feature === "augments" && update.key === "me") {
        // Deduplicate GEP double-fires
        const offerKey = typeof update.value === "string" ? update.value : "";
        if (offerKey === lastOfferKey) {
          overlayLog.debug("GEP augment offer deduplicated — skipping");
          return;
        }
        lastOfferKey = offerKey;

        try {
          const parsed =
            typeof update.value === "string"
              ? JSON.parse(update.value)
              : update.value;
          const names = [
            parsed.augment_1?.name,
            parsed.augment_2?.name,
            parsed.augment_3?.name,
          ].filter(Boolean) as string[];

          handleAugmentOffer(names);
        } catch {
          overlayLog.warn("Failed to parse GEP augment offer payload");
        }
      }

      if (update.feature === "augments" && update.key === "picked_augment") {
        handleAugmentPicked();
      }
    });

    return () => unlisten();
  }, [handleAugmentOffer, handleAugmentPicked]);

  return (
    <div style={rootStyle}>
      {DEBUG_OVERLAY && <DebugCalibration />}
      <AugmentBadges offer={augmentOffer} coaching={coachingData} />
    </div>
  );
}

/** Lazy-loaded calibration grid — only imported when DEBUG_OVERLAY is enabled */
const LazyCalibrationGrid = lazy(() =>
  import("./CalibrationGrid").then((m) => ({ default: m.CalibrationGrid }))
);

function DebugCalibration() {
  const handleF8Capture = useCallback(async () => {
    await window.electronAPI?.invoke("capture-calibration-screenshot");
  }, []);

  return (
    <Suspense fallback={null}>
      <LazyCalibrationGrid onF8Capture={handleF8Capture} />
    </Suspense>
  );
}

const rootStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  pointerEvents: "none",
  overflow: "hidden",
};
