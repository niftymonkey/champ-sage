import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BehaviorSubject, Subject } from "rxjs";
import type { CoachingResponse } from "../lib/ai/types";
import { getLogger } from "../lib/logger";
import { createSlotResolver } from "./slot/resolver";
import type {
  ActiveSlotItem,
  PlanRevisionPayload,
  ThreatSpikePayload,
  VoiceAnswerPayload,
} from "./slot/types";
import { VoiceRestingCard } from "./slot/cards/VoiceRestingCard";
import { PlanRevisionCard } from "./slot/cards/PlanRevisionCard";
import { ThreatSpikeCard } from "./slot/cards/ThreatSpikeCard";
import { EmptyPromptCard } from "./slot/cards/EmptyPromptCard";
import { PUSH_TO_TALK_HOTKEY, formatHotkeyLabel } from "../hooks/useVoiceInput";

const stripLog = getLogger("overlay:strip");

/**
 * Strip markdown bold/italic markers from raw LLM output before rendering
 * inside the v16 cards (which control their own emphasis).
 */
function stripMarkdown(text: string): string {
  return text.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
}

/**
 * Safety timeout for the thinking state. The resolver does not own thinking;
 * it is a transient overlay that runs at the renderer level between the PTT
 * release and the answer arrival, so we manage it locally.
 */
const THINKING_TIMEOUT_MS = 27_000;
/** Long-press duration before a card is considered pinned (v16 spec). */
const PIN_HOLD_MS = 200;

/**
 * Bottom-right slot host. The resolver picks the active state body; this
 * component subscribes, switches on the variant, and adds the cross-cutting
 * IPC concerns (drag in edit mode, force-clear, thinking overlay between
 * a voice request and its answer).
 */
export function CoachingStripWindow() {
  const [activeItem, setActiveItem] = useState<ActiveSlotItem | null>(null);
  const [thinking, setThinking] = useState(false);
  const [editing, setEditing] = useState(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastReportedHeightRef = useRef(0);
  // Tracks whether the slot has hosted any content (card or thinking)
  // since edit mode last toggled on. Once true, the edit-mode placeholder
  // is suppressed for the rest of this edit session - the user does not
  // want a fake card popping back in when a real one expires.
  const hasShownContentThisEditRef = useRef(false);

  // Subjects feeding the resolver. Memo so they survive re-renders; the
  // resolver subscribes to them once and keeps a stable reference.
  const inputs = useMemo(
    () => ({
      voiceAnswer$: new Subject<VoiceAnswerPayload>(),
      planRevision$: new Subject<PlanRevisionPayload>(),
      threatSpike$: new Subject<ThreatSpikePayload>(),
      // Empty visibility intentionally false in Phase 4. The visibility
      // module exists with full tests; wiring the gameStarted IPC channel
      // from main -> overlay so the empty card can fire is a follow-up.
      emptyVisible$: new BehaviorSubject<boolean>(false),
      dismiss$: new Subject<void>(),
      pin$: new Subject<void>(),
    }),
    []
  );

  // Build the resolver once. Threat-spike stays suppressed by default
  // until the Riot policy gate (Phase 0) clears.
  const slot$ = useMemo(() => createSlotResolver(inputs), [inputs]);

  useEffect(() => {
    const sub = slot$.subscribe(setActiveItem);
    return () => sub.unsubscribe();
  }, [slot$]);

  // Coaching request: enter thinking state until the response arrives.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCoachingRequest) return;

    const unlisten = api.onCoachingRequest(() => {
      stripLog.info("Coaching request received - entering thinking state");
      setThinking(true);
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = setTimeout(() => {
        stripLog.warn(
          `Thinking timeout after ${THINKING_TIMEOUT_MS}ms - clearing`
        );
        setThinking(false);
      }, THINKING_TIMEOUT_MS);
    });

    return () => unlisten();
  }, []);

  // Coaching response: dispatch by source into the resolver's input streams.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCoachingResponse) return;

    const unlisten = api.onCoachingResponse((data: unknown) => {
      const response = data as CoachingResponse & {
        source?: string;
        question?: string;
        rev?: number;
      };
      if (!response?.answer) {
        stripLog.warn("Response received with no answer - ignoring");
        return;
      }
      // Augment-fit responses live on the separate badge overlay window.
      if (response.source === "augment") return;

      setThinking(false);
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }

      const cleaned = stripMarkdown(response.answer);
      const timestamp = Date.now();

      if (response.source === "plan") {
        inputs.planRevision$.next({
          summary: cleaned,
          // The current IPC payload does not include the rev counter;
          // default to 1 until the main process plumbs it through.
          rev: response.rev ?? 1,
          timestamp,
        });
        return;
      }

      // Voice + item-rec + unknown all read as a coach voice answer in the
      // slot. Item-rec is proactive but uses the same body shape today.
      inputs.voiceAnswer$.next({
        // Question text isn't on the response payload yet - cards render
        // the answer alone when question is empty.
        question: response.question ?? "",
        answer: cleaned,
        timestamp,
      });
    });

    return () => unlisten();
  }, [inputs]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onOverlayEditMode) return;

    const unlisten = api.onOverlayEditMode(({ editing: isEditing }) => {
      setEditing(isEditing);
      if (isEditing) {
        // Reset on every entry: if there is currently a card showing, treat
        // it as content seen this session (no placeholder). If not, the
        // first card to arrive will set this true.
        hasShownContentThisEditRef.current = activeItem !== null || thinking;
      }
    });

    return () => unlisten();
  }, [activeItem, thinking]);

  // Once any real content shows during edit mode, latch the flag so the
  // placeholder never reappears for this edit session.
  useEffect(() => {
    if (editing && (activeItem !== null || thinking)) {
      hasShownContentThisEditRef.current = true;
    }
  }, [editing, activeItem, thinking]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onClearOverlays) return;

    const unlisten = api.onClearOverlays(() => {
      stripLog.info("Clear overlays - resetting strip state");
      setThinking(false);
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      inputs.dismiss$.next();
    });

    return () => unlisten();
  }, [inputs]);

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
      if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    };
  }, []);

  // Auto-fit the strip window to the active card's height. Frameless
  // transparent windows have no OS resize handles, so the renderer
  // measures content and tells main exactly how tall to make the window.
  // ResizeObserver fires whenever the card's size changes (state switch,
  // text reflow, font load, etc.).
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const reportHeight = (): void => {
      const measured = Math.ceil(el.getBoundingClientRect().height);
      // 32px floor accounts for the drag handle + a tiny bit of breathing
      // room when the slot is empty so the edit-mode placeholder is still
      // visibly grabbable.
      const target = Math.max(32, measured);
      if (Math.abs(target - lastReportedHeightRef.current) < 2) return;
      lastReportedHeightRef.current = target;
      window.electronAPI?.resizeStripToContent(target);
    };
    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeItem, thinking, editing]);

  // Click on the card dismisses; long-press pins (voice-resting only).
  const handleMouseDown = useCallback(() => {
    if (editing) {
      window.electronAPI?.startStripDrag();
      return;
    }
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    pinTimerRef.current = setTimeout(() => {
      inputs.pin$.next();
      pinTimerRef.current = null;
    }, PIN_HOLD_MS);
  }, [editing, inputs]);

  const handleMouseUp = useCallback(() => {
    if (editing) return;
    if (pinTimerRef.current !== null) {
      clearTimeout(pinTimerRef.current);
      pinTimerRef.current = null;
      inputs.dismiss$.next();
    }
  }, [editing, inputs]);

  const hotkeyLabel = formatHotkeyLabel(PUSH_TO_TALK_HOTKEY);
  const showThinking = thinking;
  // In edit mode the strip always renders something visible so the player
  // has a drag target. Without this the wrapper would return null when the
  // slot is empty - the window would still be mouse-interactive, but the
  // user would have nothing to grab onto.
  const visible = editing || showThinking || activeItem !== null;

  if (!visible) return null;

  return (
    <div
      ref={contentRef}
      style={hostStyle}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {editing ? <div style={dragHandleStyle}>DRAG TO MOVE</div> : null}
      {editing ? <ResizeGrip /> : null}
      {showThinking ? (
        <div style={thinkingCardStyle}>Analyzing…</div>
      ) : activeItem ? (
        <ActiveCard item={activeItem} hotkeyLabel={hotkeyLabel} />
      ) : editing && !hasShownContentThisEditRef.current ? (
        <div style={editPlaceholderStyle}>
          <p style={editPlaceholderHeadingStyle}>Drag to position</p>
          <p style={editPlaceholderBodyStyle}>
            This is roughly the size of a real coach card. Move the strip here,
            then press Shift+Tab to leave edit mode. Coach responses grow
            downward from this top edge.
          </p>
        </div>
      ) : null}
    </div>
  );
}

interface ActiveCardProps {
  item: ActiveSlotItem;
  hotkeyLabel: string;
}

function ActiveCard({ item, hotkeyLabel }: ActiveCardProps) {
  switch (item.kind) {
    case "voice-resting":
      return <VoiceRestingCard payload={item.payload} pinned={item.pinned} />;
    case "plan-revision":
      return <PlanRevisionCard payload={item.payload} />;
    case "threat-spike":
      return <ThreatSpikeCard payload={item.payload} />;
    case "empty":
      return <EmptyPromptCard hotkeyLabel={hotkeyLabel} />;
  }
}

/**
 * Bottom-right corner grip that converts a mouse drag into an absolute
 * resize. Frameless transparent windows have no OS resize handles, so
 * this provides one in the renderer. Once the user resizes via this grip,
 * main latches stripUserSized=true and stops auto-fitting to content.
 *
 * The grip captures pointer events and computes new dimensions from the
 * window's current outer width/height (window.outerWidth / outerHeight)
 * plus the cursor delta since drag start. The IPC tells main the absolute
 * target size; main applies it and locks the size.
 */
function ResizeGrip() {
  const startRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      startRef.current = {
        x: e.screenX,
        y: e.screenY,
        w: window.outerWidth,
        h: window.outerHeight,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!start) return;
      const newWidth = Math.max(200, start.w + (e.screenX - start.x));
      const newHeight = Math.max(80, start.h + (e.screenY - start.y));
      window.electronAPI?.setStripSize(newWidth, newHeight);
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      startRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may have been released by another path.
      }
    },
    []
  );

  return (
    <div
      style={resizeGripStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      title="Drag to resize. Clear Overlays restores auto-fit."
    />
  );
}

/**
 * Host wrapper for the active card. Width fills the strip window so a
 * dragged drop point matches expectations; height is content-driven so
 * ResizeObserver reports the card's natural size up to main, which then
 * fits the window to it. The transparent area outside the card stays
 * click-through.
 */
const hostStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  pointerEvents: "auto",
  userSelect: "none",
  boxSizing: "border-box",
  padding: "8px",
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
  marginBottom: 4,
  flexShrink: 0,
};

// Bottom-right resize grip shown only in edit mode. Oxblood diagonal
// hatch so it reads as a resize affordance (consistent with the v16
// palette, distinct from the orange drag handle at the top).
const resizeGripStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  bottom: 0,
  width: 18,
  height: 18,
  cursor: "nwse-resize",
  background:
    "linear-gradient(135deg, transparent 0 30%, rgba(176,74,78,0.9) 30% 45%, transparent 45% 55%, rgba(176,74,78,0.9) 55% 70%, transparent 70%)",
  zIndex: 10,
  touchAction: "none",
};

const thinkingCardStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif",
  fontStyle: "italic",
  fontSize: 14,
  color: "rgba(232, 234, 238, 0.7)",
  background: "rgba(17, 19, 21, 0.82)",
  border: "1px solid rgba(255, 255, 255, 0.06)",
  borderRadius: 6,
  padding: "10px 14px",
  animation: "thinking-pulse 1.5s ease-in-out infinite",
};

// Placeholder card shown only while edit mode is on AND the slot is empty.
// Sized to match a typical voice-resting card (italic question + chip + 3-4
// lines of italic answer), so when the user drags this into position the
// strip's footprint won't change dramatically when a real card arrives.
const editPlaceholderStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  color: "rgba(232, 234, 238, 0.85)",
  background: "rgba(17, 19, 21, 0.82)",
  border: "1px dashed rgba(255, 255, 255, 0.28)",
  borderRadius: 6,
  padding: "16px 18px",
  maxWidth: 380,
  width: "100%",
  // Approximate height of a typical voice-resting card so what the user
  // drags is roughly what a real card will look like in the same spot.
  minHeight: 168,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 8,
  boxSizing: "border-box",
};

const editPlaceholderHeadingStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(214, 121, 123, 0.95)",
  margin: 0,
};

const editPlaceholderBodyStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif",
  fontStyle: "italic",
  fontSize: 14,
  color: "rgba(240, 238, 240, 0.9)",
  lineHeight: 1.55,
  margin: 0,
};
