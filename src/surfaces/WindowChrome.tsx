import type { ReactNode } from "react";
import type { Surface } from "./resolveSurface";
import styles from "./WindowChrome.module.css";

const TABS: ReadonlyArray<{ id: Surface; label: string }> = [
  { id: "idle", label: "Home" },
  // Labelled "Game" rather than "In Game" so the tab still reads
  // sensibly when it's showing the just-finished match's snapshot
  // (post-end-of-game, before the next game starts). Issue #84 will
  // generalise this surface to "the game I'm viewing" with a real
  // rejoin affordance.
  { id: "in-game", label: "Game" },
  { id: "post-game", label: "History" },
  { id: "settings", label: "Settings" },
];

interface WindowChromeProps {
  surface: Surface;
  onNavigate: (next: Surface) => void;
  /**
   * Right-region content. The redesign expects a tight mono status string
   * (NO LIVE GAME / LIVE / etc.) plus an optional hint pill, not a stack of
   * controls. Whoever mounts the chrome decides what to put here.
   */
  statusContent?: ReactNode;
  /** Optional eyebrow text immediately after the wordmark, e.g. "WELCOME BACK · 17:42". */
  eyebrow?: string;
  /**
   * True when there is no live game (no active player, no champ-select).
   * IN GAME becomes a no-op until something is happening; the visual
   * affordance also dims so the player knows the tab isn't useful.
   */
  inGameDisabled?: boolean;
}

export function WindowChrome({
  surface,
  onNavigate,
  statusContent,
  eyebrow,
  inGameDisabled = false,
}: WindowChromeProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.wordmark}>Champ Sage</span>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      </div>
      <nav className={styles.nav}>
        {TABS.map((tab) => {
          const active = isTabActive(tab.id, surface);
          const disabled = tab.id === "in-game" && inGameDisabled;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              className={`${styles.tab} ${active ? styles.tabActive : ""} ${disabled ? styles.tabDisabled : ""}`}
              onClick={() => onNavigate(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      <div className={styles.right}>{statusContent}</div>
    </header>
  );
}

/**
 * `champ-select` is not a tab; while it is the live surface we highlight
 * IN GAME so the user knows which tab "owns" the current screen.
 */
function isTabActive(tab: Surface, surface: Surface): boolean {
  if (tab === surface) return true;
  if (tab === "in-game" && surface === "champ-select") return true;
  return false;
}
