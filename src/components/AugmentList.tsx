import { useState, useMemo } from "react";
import type { Augment, AugmentMode } from "../lib/data-ingest/types";
import { AugmentCard } from "./AugmentCard";

interface AugmentListProps {
  augments: Map<string, Augment>;
}

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
  const [modeFilter, setModeFilter] = useState<AugmentMode>("mayhem");
  const [tierFilters, setTierFilters] = useState<Set<Tier>>(new Set(TIERS));
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  function toggleTier(tier: Tier) {
    setTierFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) {
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

  const setNames = useMemo(() => {
    const names = new Set<string>();
    for (const a of modeFiltered) {
      for (const s of a.sets) names.add(s);
    }
    return [...names].sort();
  }, [modeFilter, augments]);

  const filtered = modeFiltered
    .filter((a) => tierFilters.has(a.tier))
    .filter((a) => (setFilter ? a.sets.includes(setFilter) : true))
    .filter((a) => {
      if (query.trim().length < 2) return true;
      const lower = query.toLowerCase();
      return (
        a.name.toLowerCase().includes(lower) ||
        a.description.toLowerCase().includes(lower)
      );
    });

  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));

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
                onClick={() => {
                  setModeFilter(mode);
                  setSetFilter(null);
                }}
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
        {setNames.length > 0 && (
          <div className="set-filter">
            <button
              className={setFilter === null ? "tab active" : "tab"}
              onClick={() => setSetFilter(null)}
            >
              All
            </button>
            {setNames.map((name) => (
              <button
                key={name}
                className={setFilter === name ? "tab active" : "tab"}
                onClick={() => setSetFilter(setFilter === name ? null : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          placeholder="Search augments..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input"
          style={{ marginTop: "0.5rem", marginBottom: 0 }}
        />
      </div>
      <p className="entity-meta" style={{ padding: "0.25rem 0" }}>
        Showing {sorted.length} augments
      </p>
      <div className="augment-card-grid">
        {sorted.map((aug) => (
          <AugmentCard key={`${aug.mode}-${aug.name}`} augment={aug} />
        ))}
      </div>
    </div>
  );
}
