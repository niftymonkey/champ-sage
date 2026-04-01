import { useCallback, useEffect, useRef, useState } from "react";
import { getLogger } from "../lib/logger";

const overlayLog = getLogger("overlay:calibration");

const SAFETY_TIMEOUT_MS = 15_000;

interface CalibrationGridProps {
  onF8Capture: () => Promise<void>;
}

/**
 * Full-screen calibration grid overlay. Toggled via a prop or can be
 * enabled alongside the production overlay for position fine-tuning.
 * Renders on augment offer, waits for F8, captures, then hides.
 */
export function CalibrationGrid({ onF8Capture }: CalibrationGridProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<boolean>(false);
  const lastOfferRef = useRef<string>("");

  const hideGrid = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    setVisible(false);
    activeRef.current = false;
  }, []);

  const triggerCalibration = useCallback(
    (offerKey: string) => {
      if (offerKey === lastOfferRef.current && activeRef.current) return;
      lastOfferRef.current = offerKey;
      if (activeRef.current) hideGrid();

      activeRef.current = true;
      overlayLog.info("Augment offer detected — showing calibration grid");
      setVisible(true);

      safetyTimerRef.current = setTimeout(() => {
        overlayLog.info("Safety timeout — hiding calibration grid");
        hideGrid();
      }, SAFETY_TIMEOUT_MS);
    },
    [hideGrid]
  );

  // Listen for augment offers
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onGepInfoUpdate) return;

    const unlisten = api.onGepInfoUpdate((payload: unknown) => {
      const update = payload as {
        feature?: string;
        key?: string;
        value?: string;
      };
      if (update.feature === "augments" && update.key === "me") {
        const offerKey = typeof update.value === "string" ? update.value : "";
        triggerCalibration(offerKey);
      }
    });

    return () => {
      unlisten();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
  }, [triggerCalibration]);

  // Listen for F8
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCalibrationCapture) return;

    const unlisten = api.onCalibrationCapture(async () => {
      if (!activeRef.current) return;

      overlayLog.info("F8 pressed — capturing screenshot");
      try {
        await onF8Capture();
        overlayLog.info("Screenshot captured successfully");
      } catch (err) {
        overlayLog.error("Screenshot capture failed:", err);
      }

      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        overlayLog.info("Hiding calibration grid");
        hideGrid();
      }, 2000);
    });

    return () => unlisten();
  }, [hideGrid, onF8Capture]);

  if (!visible) return null;

  return (
    <div style={gridContainerStyle}>
      <GridLines />
      <CoordinateLabels />
      <F8Prompt />
    </div>
  );
}

const GRID_SPACING = 50;

function GridLines() {
  const lines: React.ReactElement[] = [];

  for (let x = 0; x <= 3840; x += GRID_SPACING) {
    const isMajor = x % 200 === 0;
    lines.push(
      <div
        key={`v-${x}`}
        style={{
          position: "absolute",
          left: x,
          top: 0,
          width: isMajor ? 2 : 1,
          height: "100%",
          backgroundColor: isMajor
            ? "rgba(255, 255, 0, 0.4)"
            : "rgba(255, 255, 255, 0.15)",
        }}
      />
    );
  }

  for (let y = 0; y <= 2160; y += GRID_SPACING) {
    const isMajor = y % 200 === 0;
    lines.push(
      <div
        key={`h-${y}`}
        style={{
          position: "absolute",
          left: 0,
          top: y,
          width: "100%",
          height: isMajor ? 2 : 1,
          backgroundColor: isMajor
            ? "rgba(255, 255, 0, 0.4)"
            : "rgba(255, 255, 255, 0.15)",
        }}
      />
    );
  }

  return <>{lines}</>;
}

function CoordinateLabels() {
  const labels: React.ReactElement[] = [];

  for (let x = 0; x <= 3840; x += 200) {
    labels.push(
      <div key={`lx-${x}`} style={{ ...labelStyle, left: x + 2, top: 2 }}>
        {x}
      </div>
    );
  }

  for (let y = 200; y <= 2160; y += 200) {
    labels.push(
      <div key={`ly-${y}`} style={{ ...labelStyle, left: 2, top: y + 2 }}>
        {y}
      </div>
    );
  }

  return <>{labels}</>;
}

function F8Prompt() {
  return <div style={promptStyle}>Press F8 to capture screenshot</div>;
}

const gridContainerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  pointerEvents: "none",
  zIndex: 9999,
};

const labelStyle: React.CSSProperties = {
  position: "absolute",
  color: "rgba(255, 255, 0, 0.8)",
  fontSize: 10,
  fontFamily: "monospace",
  textShadow: "0 0 2px black, 0 0 2px black",
  pointerEvents: "none",
};

const promptStyle: React.CSSProperties = {
  position: "fixed",
  top: 20,
  left: "50%",
  transform: "translateX(-50%)",
  color: "#fff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 16,
  fontFamily: "monospace",
  fontWeight: "bold",
  pointerEvents: "none",
  zIndex: 10000,
};
