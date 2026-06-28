import type { GepHealthVerdict } from "../lib/gep-health";

interface GepHealthBannerProps {
  verdict: GepHealthVerdict | null;
  onRestart: () => void;
}

/**
 * Shown in the desktop window when the loaded GEP cannot deliver augment events
 * this patch. A `red` verdict (below the floor or a stub) is fixable by loading
 * a newer build, which requires a relaunch, so it offers a "Restart now" action;
 * the player can click it between games or ignore it and keep playing on the
 * running app. A `warn` verdict is a platform-side feature outage a restart
 * cannot fix, so it is an informational note only. Nothing renders on green.
 */
export function GepHealthBanner({ verdict, onRestart }: GepHealthBannerProps) {
  if (!verdict || verdict.level === "green") return null;

  if (verdict.level === "warn") {
    return (
      <div className="gep-health-banner gep-health-banner--warn" role="status">
        <span className="gep-health-banner__text">
          Augment coaching may be unreliable this game. Build and item coaching
          are unaffected.
        </span>
      </div>
    );
  }

  return (
    <div className="gep-health-banner gep-health-banner--red" role="alert">
      <span className="gep-health-banner__text">Update required</span>
      <button
        type="button"
        className="gep-health-banner__action"
        onClick={onRestart}
      >
        Restart now
      </button>
    </div>
  );
}
