import { useState, useMemo } from "react";
import type { Augment } from "../lib/data-ingest/types";
import { AugmentCard } from "./AugmentCard";

interface AugmentPickerProps {
  augments: Map<string, Augment>;
  onSelect: (augment: Augment) => void;
}

export function AugmentPicker({ augments, onSelect }: AugmentPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const all = [...augments.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (query.trim().length < 2) return all;

    const lower = query.toLowerCase();
    return all.filter(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        a.description.toLowerCase().includes(lower) ||
        a.sets.some((s) => s.toLowerCase().includes(lower))
    );
  }, [augments, query]);

  return (
    <div className="augment-picker">
      <input
        type="text"
        placeholder="Search augments..."
        aria-label="Search augments"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="search-input"
      />
      <p className="entity-meta">{filtered.length} augments</p>
      <div className="augment-card-grid">
        {filtered.map((aug) => (
          <AugmentCard
            key={`${aug.mode}-${aug.name}`}
            augment={aug}
            onClick={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
