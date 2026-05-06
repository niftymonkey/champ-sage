import { useCallback, useEffect, useRef, useState } from "react";
import { ClearOverlaysButton } from "../components/ClearOverlaysButton";
import { ResetStripSizeButton } from "../components/ResetStripSizeButton";
import { SettingRow } from "../components/settings/SettingRow";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { SETTING_GROUPS } from "../lib/settings";
import styles from "./SettingsSurface.module.css";

/**
 * Settings surface — v16 layout: a left-rail nav of sections with a
 * scrollable canvas of grouped rows on the right. Clicking a rail
 * entry scrolls the canvas to that section's anchor; the rail's
 * active highlight follows whichever section is currently in view.
 *
 * Sections are mostly driven by `SETTING_GROUPS` (typed prefs the
 * Settings module renders polymorphically), plus two custom blocks
 * the registry doesn't model: "Overlays" (one-off action buttons)
 * and "About" (renderer build / dataset info).
 */
export function SettingsSurface() {
  const { gameData } = useCoachingContext();
  const sections = useSectionsList();
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    const el = sectionRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Auto-update active state from scroll position. The section nearest
  // the top of the canvas viewport wins. Cheap O(N) read against ~5
  // anchors so no observer needed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onScroll = (): void => {
      const top = canvas.scrollTop + 16;
      let nextId = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = sectionRefs.current.get(s.id);
        if (el && el.offsetTop <= top) nextId = s.id;
      }
      setActiveId(nextId);
    };
    canvas.addEventListener("scroll", onScroll, { passive: true });
    return () => canvas.removeEventListener("scroll", onScroll);
  }, [sections]);

  return (
    <div className={styles.surface}>
      <nav className={styles.rail} aria-label="Settings sections">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`${styles.railItem} ${activeId === s.id ? styles.railItemActive : ""}`}
            onClick={() => handleSelect(s.id)}
          >
            <span className={styles.railLabel}>{s.title}</span>
            {s.caption ? (
              <span className={styles.railCaption}>{s.caption}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className={styles.canvas} ref={canvasRef}>
        {SETTING_GROUPS.map((group) => (
          <Section
            key={group.id}
            id={group.id}
            title={group.title}
            description={group.description}
            anchorRef={(el) => registerAnchor(sectionRefs, group.id, el)}
          >
            {group.settings.map((setting) => (
              <SettingRow key={setting.key} setting={setting} />
            ))}
          </Section>
        ))}

        <Section
          id="overlays"
          title="Overlays"
          anchorRef={(el) => registerAnchor(sectionRefs, "overlays", el)}
        >
          <UtilityRow
            label="Clear overlay state"
            description="Hides every overlay window for the rest of the current session."
          >
            <ClearOverlaysButton />
          </UtilityRow>
          <UtilityRow
            label="Coach strip size"
            description="The strip auto-fits its content by default. After dragging the corner grip in edit mode it locks to that size; this restores auto-fit."
          >
            <ResetStripSizeButton />
          </UtilityRow>
        </Section>

        <Section
          id="about"
          title="About"
          anchorRef={(el) => registerAnchor(sectionRefs, "about", el)}
        >
          <div className={styles.aboutBlock}>
            <div className={styles.aboutLine}>
              <span className={styles.aboutLabel}>Patch</span>
              <span className={styles.aboutValue}>
                {gameData?.version ?? "unknown"}
              </span>
            </div>
            <div className={styles.aboutLine}>
              <span className={styles.aboutLabel}>Champions loaded</span>
              <span className={styles.aboutValue}>
                {gameData?.champions.size ?? 0}
              </span>
            </div>
            <div className={styles.aboutLine}>
              <span className={styles.aboutLabel}>Items loaded</span>
              <span className={styles.aboutValue}>
                {gameData?.items.size ?? 0}
              </span>
            </div>
            <div className={styles.aboutLine}>
              <span className={styles.aboutLabel}>Augments loaded</span>
              <span className={styles.aboutValue}>
                {gameData?.augments.size ?? 0}
              </span>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

/**
 * Section list combines the typed-settings registry with the
 * surface-only sections (Overlays, About). Defined once so the rail
 * and the canvas share the same source of truth.
 */
function useSectionsList(): ReadonlyArray<{
  id: string;
  title: string;
  caption?: string;
}> {
  return [
    ...SETTING_GROUPS.map(({ id, title, caption }) => ({ id, title, caption })),
    { id: "overlays", title: "Overlays", caption: "Strip + clear" },
    { id: "about", title: "About", caption: "Patch + dataset" },
  ];
}

interface SectionProps {
  id: string;
  title: string;
  description?: string;
  anchorRef: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}

function Section({
  id,
  title,
  description,
  anchorRef,
  children,
}: SectionProps) {
  return (
    <section id={`settings-${id}`} ref={anchorRef} className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {description ? (
        <p className={styles.sectionDescription}>{description}</p>
      ) : null}
      <div className={styles.sectionRows}>{children}</div>
    </section>
  );
}

function UtilityRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.utilityRow}>
      <div className={styles.utilityText}>
        <span className={styles.utilityLabel}>{label}</span>
        <p className={styles.utilityDescription}>{description}</p>
      </div>
      <div className={styles.utilityControl}>{children}</div>
    </div>
  );
}

function registerAnchor(
  refs: React.MutableRefObject<Map<string, HTMLElement>>,
  id: string,
  el: HTMLElement | null
): void {
  if (el) refs.current.set(id, el);
  else refs.current.delete(id);
}
