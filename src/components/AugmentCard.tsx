import type { Augment } from "../lib/data-ingest/types";

interface AugmentCardProps {
  augment: Augment;
  onClick?: (augment: Augment) => void;
  compact?: boolean;
}

export function AugmentCard({ augment, onClick, compact }: AugmentCardProps) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      className={`augment-card tier-border-${augment.tier.toLowerCase()}${compact ? " augment-card-compact" : ""}`}
      onClick={onClick ? () => onClick(augment) : undefined}
    >
      {augment.iconPath && (
        <img
          className="augment-card-icon"
          src={augment.iconPath}
          alt={augment.name}
          loading="lazy"
        />
      )}
      <span className="augment-card-name">{augment.name}</span>
      {!compact && augment.description && (
        <span className="augment-card-desc">{augment.description}</span>
      )}
      {!compact && augment.sets.length > 0 && (
        <span className="augment-card-sets">
          {augment.sets.map((s) => (
            <span key={s} className="augment-card-set">
              {s}
            </span>
          ))}
        </span>
      )}
    </Tag>
  );
}
