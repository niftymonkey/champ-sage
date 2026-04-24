import { useCallback } from "react";
import { getLogger } from "../lib/logger";
import styles from "./ClearOverlaysButton.module.css";

const appLog = getLogger("app");

/**
 * Escape hatch for stuck overlays (#111). Sends the `clear-overlays`
 * IPC to the main process, which broadcasts a reset to every overlay
 * window and forces a compositor flush. Global Ctrl+Shift+Space does
 * the same thing via the ow-electron hotkey bridge.
 */
export function ClearOverlaysButton() {
  const handleClick = useCallback(() => {
    appLog.info("Clear overlays button clicked");
    window.electronAPI?.clearOverlays();
  }, []);

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleClick}
      title="Reset overlay state and force repaint (Ctrl+Shift+Space)"
    >
      Clear overlays
    </button>
  );
}
