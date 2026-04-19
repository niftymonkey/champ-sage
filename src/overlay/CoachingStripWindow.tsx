import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CoachingResponse } from "../lib/ai/types";
import { getLogger } from "../lib/logger";

const stripLog = getLogger("overlay:strip");

/** Strip markdown bold/italic markers from LLM output */
function stripMarkdown(text: string): string {
  return text.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
}

/** How long text stays visible before dimming */
const FRESH_DURATION_MS = 8_000;

/**
 * Safety timeout for thinking state — if no response arrives, stop showing "Analyzing".
 * Sized to cover one LLM call plus a silent retry on schema parse failure (#102).
 * Kept ~2s above the badge overlay's ANALYZING_TIMEOUT_MS so the strip doesn't
 * disappear before the badges do.
 */
const THINKING_TIMEOUT_MS = 27_000;

const MAX_FONT_SIZE = 16;
const MIN_FONT_SIZE = 9;

const VISIBLE_OPACITY = 0.9;
const DIMMED_OPACITY = 0.25;

/**
 * Standalone coaching strip window. Runs in its own noPassThrough
 * overlay window. Click-through by default; draggable when Shift+Tab held.
 *
 * Opacity is a pure derivation:
 *   thinking OR fresh OR editing  → 0.9
 *   otherwise                     → 0.25
 */
export function CoachingStripWindow() {
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [visible, setVisible] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fontSize, setFontSize] = useState(MAX_FONT_SIZE);
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  // Listen for coaching request (show thinking state)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCoachingRequest) return;

    const unlisten = api.onCoachingRequest(() => {
      stripLog.info("Coaching request received — entering thinking state");
      setThinking(true);
      setVisible(true);
      setFresh(true);
      if (freshTimerRef.current) {
        stripLog.debug("Clearing existing fresh timer (request supersedes)");
        clearTimeout(freshTimerRef.current);
      }
      // Safety timeout — if no response arrives, stop showing "Analyzing"
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = setTimeout(() => {
        stripLog.warn(
          `Thinking timeout after ${THINKING_TIMEOUT_MS}ms — no response received, clearing thinking state`
        );
        setThinking(false);
      }, THINKING_TIMEOUT_MS);
    });

    return () => unlisten();
  }, []);

  // Listen for coaching response
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCoachingResponse) return;

    const unlisten = api.onCoachingResponse((data: unknown) => {
      const response = data as CoachingResponse & { source?: string };
      if (!response?.answer) {
        stripLog.warn("Response received with no answer — ignoring", {
          hasResponse: !!response,
          source: response?.source,
        });
        return;
      }
      if (response.source === "augment") return;

      const sentAt = (response as unknown as { sentAt?: number }).sentAt;
      const delay = sentAt ? Date.now() - sentAt : null;
      stripLog.info(
        `Coaching response received (source=${response.source ?? "unknown"}) — updating strip`,
        { answerLength: response.answer.length, delayMs: delay }
      );
      setText(stripMarkdown(response.answer));
      setThinking(false);
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setVisible(true);
      setFresh(true);

      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
      freshTimerRef.current = setTimeout(() => {
        stripLog.debug(
          `Fresh timer expired after ${FRESH_DURATION_MS}ms — dimming`
        );
        setFresh(false);
      }, FRESH_DURATION_MS);
    });

    return () => unlisten();
  }, []);

  // Listen for edit mode toggle (Shift+Tab)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onOverlayEditMode) return;

    const unlisten = api.onOverlayEditMode(({ editing: isEditing }) => {
      stripLog.debug(`Edit mode: ${isEditing ? "ON" : "OFF"}`);
      setEditing(isEditing);
    });

    return () => unlisten();
  }, []);

  // Log significant state changes (thinking/visible transitions, not hover)
  useEffect(() => {
    stripLog.debug(
      `Strip: thinking=${thinking}, fresh=${fresh}, visible=${visible}`
    );
  }, [visible, thinking, fresh]);

  // Auto-size font to fit container
  useLayoutEffect(() => {
    if (!text || thinking || !containerRef.current || !textRef.current) return;

    setFontSize(MAX_FONT_SIZE);

    requestAnimationFrame(() => {
      const container = containerRef.current;
      const textEl = textRef.current;
      if (!container || !textEl) return;

      let size = MAX_FONT_SIZE;
      while (
        size > MIN_FONT_SIZE &&
        textEl.scrollHeight > container.clientHeight
      ) {
        size -= 0.5;
        textEl.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    });
  }, [text, thinking]);

  const handleMouseDown = useCallback(() => {
    if (!editing) return;
    window.electronAPI?.startStripDrag();
  }, [editing]);

  useEffect(() => {
    return () => {
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  const opacity =
    thinking || fresh || editing ? VISIBLE_OPACITY : DIMMED_OPACITY;

  return (
    <div
      ref={containerRef}
      style={{
        ...containerStyle,
        opacity,
        transition: "opacity 0.5s ease",
        // Inset shadow instead of border — doesn't overflow the window bounds
        boxShadow: editing ? "inset 0 0 0 2px rgba(255, 165, 0, 0.8)" : "none",
      }}
      onMouseDown={handleMouseDown}
    >
      {editing && <div style={dragHandleStyle}>DRAG TO MOVE</div>}
      {thinking ? (
        <span style={thinkingStyle}>Analyzing...</span>
      ) : (
        <span ref={textRef} style={{ fontSize }}>
          {text}
        </span>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  backgroundColor: "rgba(0, 0, 0, 0.8)",
  borderRadius: 6,
  color: "#fff",
  fontFamily: "monospace",
  lineHeight: 1.3,
  textAlign: "center",
  padding: "4px 12px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
  pointerEvents: "auto",
  boxSizing: "border-box",
};

const dragHandleStyle: React.CSSProperties = {
  backgroundColor: "rgba(255, 165, 0, 0.9)",
  color: "#000",
  padding: "2px 8px",
  fontSize: 10,
  fontWeight: "bold",
  textAlign: "center",
  cursor: "grab",
  borderRadius: 3,
  marginBottom: 2,
  flexShrink: 0,
};

const thinkingStyle: React.CSSProperties = {
  color: "rgba(255, 255, 255, 0.7)",
  fontSize: 13,
  animation: "thinking-pulse 1.5s ease-in-out infinite",
};
