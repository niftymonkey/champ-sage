import { useState } from "react";
import type { Augment, AugmentMode } from "../lib/data-ingest/types";

interface AugmentListProps {
  augments: Map<string, Augment>;
}

const TIER_ORDER: Record<string, number> = {
  Prismatic: 0,
  Gold: 1,
  Silver: 2,
};

type Tier = Augment["tier"];
const TIERS: Tier[] = ["Prismatic", "Gold", "Silver"];
const MODES: AugmentMode[] = ["mayhem", "arena", "swarm", "unknown"];

const MODE_LABELS: Record<AugmentMode, string> = {
  mayhem: "Mayhem",
  arena: "Arena",
  swarm: "Swarm",
  unknown: "Other",
};

export function AugmentList({ augments }: AugmentListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<AugmentMode>("mayhem");
  const [tierFilters, setTierFilters] = useState<Set<Tier>>(new Set(TIERS));

  function toggleTier(tier: Tier) {
    setTierFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) {
        // Don't allow deselecting all
        if (next.size > 1) next.delete(tier);
      } else {
        next.add(tier);
      }
      return next;
    });
  }

  const modeFiltered = [...augments.values()].filter(
    (a) => a.mode === modeFilter
  );

  const filtered = modeFiltered.filter((a) => tierFilters.has(a.tier));

  const sorted = filtered.sort((a, b) => {
    const tierDiff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
    if (tierDiff !== 0) return tierDiff;
    return a.name.localeCompare(b.name);
  });

  const modeCounts = new Map<AugmentMode, number>();
  for (const a of augments.values()) {
    modeCounts.set(a.mode, (modeCounts.get(a.mode) ?? 0) + 1);
  }

  const tierCounts = new Map<Tier, number>();
  for (const a of modeFiltered) {
    tierCounts.set(a.tier, (tierCounts.get(a.tier) ?? 0) + 1);
  }

  return (
    <div>
      <div className="filter-bar sticky">
        <div className="mode-filter">
          {MODES.map((mode) => {
            const count = modeCounts.get(mode) ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={mode}
                className={modeFilter === mode ? "tab active" : "tab"}
                onClick={() => setModeFilter(mode)}
              >
                {MODE_LABELS[mode]} ({count})
              </button>
            );
          })}
        </div>
        <div className="tier-filter">
          {TIERS.map((tier) => {
            const count = tierCounts.get(tier) ?? 0;
            return (
              <button
                key={tier}
                className={`tier-btn tier-${tier.toLowerCase()}${tierFilters.has(tier) ? " active" : ""}`}
                onClick={() => toggleTier(tier)}
              >
                {tier} ({count})
              </button>
            );
          })}
        </div>
      </div>
      <div className="entity-list">
        {sorted.map((aug) => (
          <div key={`${aug.mode}-${aug.name}`} className="entity-item">
            <div
              className="entity-header"
              onClick={() =>
                setExpanded(expanded === aug.name ? null : aug.name)
              }
            >
              <span className="entity-name">{aug.name}</span>
              <span className="entity-meta">
                <span className={`tier tier-${aug.tier.toLowerCase()}`}>
                  {aug.tier}
                </span>
              </span>
            </div>
            {expanded === aug.name && (
              <div className="entity-details">
                {aug.description ? (
                  <p>{aug.description}</p>
                ) : (
                  <p className="entity-meta">No description available</p>
                )}
                {aug.set !== "-" && (
                  <p className="entity-title">Set: {aug.set}</p>
                )}
                {aug.id != null && (
                  <p className="entity-meta">
                    ID: {aug.id} | Mode: {MODE_LABELS[aug.mode]}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
