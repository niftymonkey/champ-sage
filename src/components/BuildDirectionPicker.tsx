import type { Champion } from "../lib/data-ingest/types";
import {
  ALL_DIRECTIONS,
  label,
  stereotypeFromClassTag,
  type BuildDirection,
} from "../lib/build-direction/taxonomy";
import styles from "./BuildDirectionPicker.module.css";

export interface BuildDirectionPickerProps {
  value: BuildDirection | null;
  onChange: (next: BuildDirection) => void;
  champion?: Champion;
  orientation?: "horizontal" | "vertical";
  size?: "compact" | "default";
}

export function BuildDirectionPicker({
  value,
  onChange,
  champion,
  orientation = "horizontal",
  size = "default",
}: BuildDirectionPickerProps) {
  const stereotype = champion
    ? stereotypeFromClassTag(champion.tags?.[0])
    : null;
  const showStereotype = value === null && stereotype !== null;
  const containerClass =
    orientation === "vertical"
      ? `${styles.picker} ${styles.pickerVertical}`
      : styles.picker;
  const sizeClass = size === "compact" ? styles.pillCompact : "";

  return (
    <div className={containerClass}>
      {ALL_DIRECTIONS.map((direction) => {
        const selected = direction === value;
        const isStereotype = showStereotype && direction === stereotype;
        const className = [
          styles.pill,
          styles[`pill_${direction}`],
          sizeClass,
          selected ? styles.pillSelected : "",
          isStereotype ? styles.pillStereotype : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={direction}
            type="button"
            aria-pressed={selected}
            data-stereotype={isStereotype}
            className={className}
            onClick={() => onChange(direction)}
          >
            {label(direction)}
          </button>
        );
      })}
    </div>
  );
}
