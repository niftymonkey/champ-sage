import { PersonalityToggle } from "../components/PersonalityToggle";
import { ClearOverlaysButton } from "../components/ClearOverlaysButton";
import styles from "./SettingsSurface.module.css";

/**
 * Settings stub. The redesign defines five real sections (Voice & input,
 * In-game overlay, Coach behavior, Data & history, About) shipping in
 * Phase 5. Until then this surface hosts the two utility controls that
 * used to live in the old top bar: coach personality and a clear-overlays
 * button. They land here so the chrome can stay clean per the v16 spec.
 */
export function SettingsSurface() {
  return (
    <div className={styles.surface}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>Settings</span>
        <h1 className={styles.headline}>Grouped by the moment they affect.</h1>
        <p className={styles.subhead}>
          Voice and input, in-game overlay, coach behavior, data and history,
          and about all ship in Phase 5. Two utility controls that used to live
          in the top bar are parked below until then.
        </p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>Coach behavior</div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Personality</span>
            <p className={styles.rowDescription}>
              How the coach phrases recommendations.
            </p>
          </div>
          <PersonalityToggle />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>In-game overlay</div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Clear overlay state</span>
            <p className={styles.rowDescription}>
              Hides every overlay window for the rest of the current session.
            </p>
          </div>
          <ClearOverlaysButton />
        </div>
      </section>
    </div>
  );
}
