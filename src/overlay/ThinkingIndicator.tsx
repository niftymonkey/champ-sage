interface ThinkingIndicatorProps {
  /** Position as percentage of viewport */
  top?: string;
  left?: string;
  transform?: string;
  /** Match the dimensions of the response badge so bottom edge aligns */
  width?: string;
  height?: number;
}

/**
 * Pulsing "Analyzing..." indicator shown while waiting for LLM response.
 * Used by both augment badges and coaching strip.
 */
export function ThinkingIndicator({
  top,
  left,
  transform,
  width,
  height,
}: ThinkingIndicatorProps) {
  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        transform,
        width,
        height,
        pointerEvents: "none",
        zIndex: 9000,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        borderRadius: 6,
        border: "2px solid rgba(255, 255, 255, 0.3)",
        animation: "thinking-pulse 1.5s ease-in-out infinite",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          color: "rgba(255, 255, 255, 0.7)",
          fontSize: 13,
          fontFamily: "monospace",
        }}
      >
        Analyzing...
      </span>
      <style>{`
        @keyframes thinking-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
