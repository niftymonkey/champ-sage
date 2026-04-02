import { useEffect, useRef, useState } from "react";
import type { CoachingResponse } from "../lib/ai/types";

const FADE_TIMEOUT_MS = 20_000;

/** Y position of coaching strip (fraction of screen height) */
const STRIP_Y = 0.05;

interface CoachingStripProps {
  coaching: CoachingResponse | null;
}

/**
 * Coaching text strip centered above the augment cards.
 * Shows LLM coaching text briefly, then auto-fades.
 *
 * In-game repositioning deferred to #18.
 */
export function CoachingStrip({ coaching }: CoachingStripProps) {
  const [visible, setVisible] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!coaching?.answer) return;

    setDisplayText(coaching.answer);
    setVisible(true);

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, FADE_TIMEOUT_MS);

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [coaching]);

  if (!visible) return null;

  return <div style={stripStyle}>{displayText}</div>;
}

const stripStyle: React.CSSProperties = {
  position: "fixed",
  top: `${STRIP_Y * 100}vh`,
  left: "25%",
  width: "50%",
  maxHeight: 80,
  backgroundColor: "rgba(0, 0, 0, 0.8)",
  color: "#fff",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 17,
  fontFamily: "monospace",
  lineHeight: 1.3,
  textAlign: "center",
  overflow: "hidden",
  pointerEvents: "none",
  zIndex: 8000,
};
