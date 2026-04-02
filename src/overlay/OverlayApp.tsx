import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AugmentBadges } from "./AugmentBadges";
import type { CoachingResponse } from "../lib/ai/types";
import { getLogger } from "../lib/logger";

const overlayLog = getLogger("overlay");

/** Enable calibration grid + F8 screenshots via VITE_DEBUG_OVERLAY=1 */
const DEBUG_OVERLAY = import.meta.env.VITE_DEBUG_OVERLAY === "1";

/**
 * Root component for the overlay window. Renders augment badges and
 * coaching strip on top of the game. All content is click-through
 * by default; holding Tab enters edit mode for repositioning.
 */
export function OverlayApp() {
  const [editing, setEditing] = useState(false);
  const [coachingData, setCoachingData] = useState<CoachingResponse | null>(
    null
  );
  const [augmentOffer, setAugmentOffer] = useState<string[] | null>(null);

  // Listen for edit mode toggle (Tab hotkey)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onOverlayEditMode) return;

    const unlisten = api.onOverlayEditMode(({ editing: isEditing }) => {
      setEditing(isEditing);
      overlayLog.info(`Edit mode: ${isEditing ? "ON" : "OFF"}`);
    });

    return () => unlisten();
  }, []);

  // Listen for coaching responses relayed from desktop window
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCoachingResponse) return;

    const unlisten = api.onCoachingResponse((data: unknown) => {
      const response = data as CoachingResponse & { source?: string };

      // Only display augment responses — reactive (voice) responses go to coaching strip
      if (response.source !== "augment") return;

      overlayLog.info("Augment coaching response received for overlay");
      setCoachingData(response);
    });

    return () => unlisten();
  }, []);

  // Listen for augment offers from GEP
  const handleAugmentOffer = useCallback((names: string[]) => {
    setAugmentOffer(names);
    // Clear previous coaching data — new offer means new recommendations
    setCoachingData(null);
  }, []);

  const handleAugmentPicked = useCallback(() => {
    setAugmentOffer(null);
    setCoachingData(null);
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
        if (offerKey === lastOfferKey) return;
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
          // Bad parse — ignore
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
      <AugmentBadges
        offer={augmentOffer}
        coaching={coachingData}
        editing={editing}
      />
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
