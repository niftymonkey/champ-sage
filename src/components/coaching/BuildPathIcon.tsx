import type { BuildPathCategory } from "../../lib/ai/types";

interface BuildPathIconProps {
  category: BuildPathCategory;
  className?: string;
}

const ICON_TITLES: Record<BuildPathCategory, string> = {
  core: "Core item",
  counter: "Counter pick",
  defensive: "Defensive",
  damage: "Damage",
  utility: "Utility",
  situational: "Situational",
};

function IconBody({ category }: { category: BuildPathCategory }) {
  switch (category) {
    case "core":
      return (
        <polygon
          points="8,1.5 9.9,6 14.5,6.3 11,9.5 12.2,14 8,11.6 3.8,14 5,9.5 1.5,6.3 6.1,6"
          fill="currentColor"
          stroke="none"
        />
      );
    case "counter":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <line x1="8" y1="1" x2="8" y2="3.8" />
          <line x1="8" y1="12.2" x2="8" y2="15" />
          <line x1="1" y1="8" x2="3.8" y2="8" />
          <line x1="12.2" y1="8" x2="15" y2="8" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </>
      );
    case "defensive":
      return (
        <path d="M8 1.5 L13.5 3.3 V8 C13.5 11.3 11.2 13.6 8 14.5 C4.8 13.6 2.5 11.3 2.5 8 V3.3 Z" />
      );
    case "damage":
      return (
        <>
          <path d="M12.5 2 L14 3.5 L6 11.5 L3 12 L3.5 9 Z" />
          <line x1="9" y1="5.5" x2="10.5" y2="7" />
        </>
      );
    case "utility":
      return (
        <>
          <circle cx="8" cy="8" r="2.2" />
          <line x1="8" y1="1.3" x2="8" y2="3.3" />
          <line x1="8" y1="12.7" x2="8" y2="14.7" />
          <line x1="1.3" y1="8" x2="3.3" y2="8" />
          <line x1="12.7" y1="8" x2="14.7" y2="8" />
          <line x1="3.2" y1="3.2" x2="4.7" y2="4.7" />
          <line x1="11.3" y1="11.3" x2="12.8" y2="12.8" />
          <line x1="3.2" y1="12.8" x2="4.7" y2="11.3" />
          <line x1="11.3" y1="4.7" x2="12.8" y2="3.2" />
        </>
      );
    case "situational":
      return (
        <>
          <circle cx="8" cy="8" r="3.2" />
          <line x1="8" y1="2" x2="8" y2="4" />
          <line x1="8" y1="12" x2="8" y2="14" />
          <line x1="2" y1="8" x2="4" y2="8" />
          <line x1="12" y1="8" x2="14" y2="8" />
        </>
      );
  }
}

export function BuildPathIcon({ category, className }: BuildPathIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-label={ICON_TITLES[category]}
      role="img"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <IconBody category={category} />
    </svg>
  );
}

export { ICON_TITLES as BUILD_PATH_CATEGORY_LABELS };
