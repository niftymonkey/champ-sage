interface UnsupportedModeBannerProps {
  /** The unrecognized mode string from `describeModeDetection`, or null. */
  gameMode: string | null;
}

/**
 * Shown when the live game reports a mode this build does not model, so no
 * coaching session is created for it.
 *
 * Silence used to be the failure: an unmodeled mode fell through to the
 * nearest registered one and coached the player against the wrong item shop
 * with full confidence (patch 16.15.1's KIWI_JADE resolving to plain ARAM).
 * Withholding advice is the right call, but only if the player can tell the
 * difference between "deliberately quiet" and "broken", so the mode string is
 * named for the bug report.
 */
export function UnsupportedModeBanner({
  gameMode,
}: UnsupportedModeBannerProps) {
  if (!gameMode) return null;

  return (
    <div className="gep-health-banner gep-health-banner--warn" role="status">
      <span className="gep-health-banner__text">
        Coaching is off this game: Champ Sage does not support this game mode
        yet ({gameMode}).
      </span>
    </div>
  );
}
