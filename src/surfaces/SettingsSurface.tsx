import { ClearOverlaysButton } from "../components/ClearOverlaysButton";
import { ResetStripSizeButton } from "../components/ResetStripSizeButton";
import { SettingRow } from "../components/settings/SettingRow";
import { SETTING_GROUPS } from "../lib/settings";
import styles from "./SettingsSurface.module.css";

/**
 * Settings surface. Iterates the declarative `SETTING_GROUPS` registry
 * to render typed setting rows; declarative-only utilities (clear
 * overlays, reset strip size) live in their own dedicated section.
 *
 * Adding a new user preference: declare a `defineX` setting in
 * `lib/settings/registry.ts`, place it in a `SETTING_GROUPS` entry,
 * done — this file picks it up automatically.
 */
export function SettingsSurface() {
  return (
    <div className={styles.surface}>
      {SETTING_GROUPS.map((group) => (
        <section key={group.title} className={styles.section}>
          <div className={styles.sectionLabel}>{group.title}</div>
          {group.settings.map((setting) => (
            <SettingRow key={setting.key} setting={setting} />
          ))}
        </section>
      ))}

      <section className={styles.section}>
        <div className={styles.sectionLabel}>Utilities</div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Clear overlay state</span>
            <p className={styles.rowDescription}>
              Hides every overlay window for the rest of the current session.
            </p>
          </div>
          <ClearOverlaysButton />
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Coach strip size</span>
            <p className={styles.rowDescription}>
              The strip auto-fits its content by default. After dragging the
              corner grip in edit mode it locks to that size; this restores
              auto-fit.
            </p>
          </div>
          <ResetStripSizeButton />
        </div>
      </section>
    </div>
  );
}
