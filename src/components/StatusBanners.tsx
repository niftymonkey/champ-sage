import type { SubsystemStatus, StatusAction } from "../lib/app-status";

export interface StatusBannersProps {
  /** Worst first; the list renders in the order it is given. */
  statuses: SubsystemStatus[];
  onAction: (action: StatusAction) => void;
}

/** What the button says. Plain verbs, not the internal action name. */
const ACTION_LABEL: Record<StatusAction, string> = {
  relaunch: "Restart now",
  "open-logs": "Open logs",
  retry: "Try again",
};

/**
 * The app's one place for telling the player something is wrong.
 *
 * This absorbed `GepHealthBanner`, which was the only visible health channel
 * and covered exactly one subsystem. Everything else, a boot step that failed,
 * a launcher that could not check the packages, settings that will not save,
 * reported only to the log, where nobody using the app would ever see it.
 *
 * The component knows nothing about GEP, packages, or the launcher: it renders
 * whatever the status list holds. That is what keeps adding a new subsystem
 * from meaning a new banner component.
 */
export function StatusBanners({ statuses, onAction }: StatusBannersProps) {
  if (statuses.length === 0) return null;

  return (
    <>
      {statuses.map(({ id, level, message, detail, action }) => (
        <div
          key={id}
          className={`status-banner status-banner--${level}`}
          // Only `broken` interrupts a screen reader. A degraded subsystem is a
          // note, and an update is good news; neither should talk over whatever
          // the player is doing.
          role={level === "broken" ? "alert" : "status"}
        >
          <span className="status-banner__text">
            {message}
            {detail ? (
              <span className="status-banner__detail">{detail}</span>
            ) : null}
          </span>
          {action ? (
            <button
              type="button"
              className="status-banner__action"
              onClick={() => onAction(action)}
            >
              {ACTION_LABEL[action]}
            </button>
          ) : null}
        </div>
      ))}
    </>
  );
}
