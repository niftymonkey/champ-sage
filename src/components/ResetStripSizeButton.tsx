import { useCallback } from "react";
import { getLogger } from "../lib/logger";
import styles from "./ClearOverlaysButton.module.css";

const appLog = getLogger("app");

/**
 * Releases the manual size lock on the in-game coaching strip. After the
 * user drags the strip's corner grip in edit mode the strip stops auto-
 * fitting to content and stays at the size they set; this button restores
 * content-driven auto-fit.
 *
 * Reuses the ClearOverlaysButton style for visual consistency - same
 * button shape, same affordance footprint.
 */
export function ResetStripSizeButton() {
  const handleClick = useCallback(() => {
    appLog.info("Reset strip size clicked");
    window.electronAPI?.resetStripSize();
  }, []);

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleClick}
      title="Forget any manual size you set on the in-game coach strip and let it size to content again."
    >
      Reset strip size
    </button>
  );
}
