import { useState } from "react";
import type { Item, ItemMode } from "../lib/data-ingest/types";

interface ItemListProps {
  items: Map<number, Item>;
}

const MODES: ItemMode[] = ["standard", "arena", "aram", "swarm", "other"];

const MODE_LABELS: Record<ItemMode, string> = {
  standard: "Standard",
  arena: "Arena Variants",
  aram: "ARAM Variants",
  swarm: "Swarm",
  other: "Other",
};

export function ItemList({ items }: ItemListProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [modeFilter, setModeFilter] = useState<ItemMode>("standard");

  const filtered = [...items.values()].filter((i) => i.mode === modeFilter);
  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));

  const modeCounts = new Map<ItemMode, number>();
  for (const item of items.values()) {
    modeCounts.set(item.mode, (modeCounts.get(item.mode) ?? 0) + 1);
  }

  return (
    <div>
      <div className="mode-filter sticky">
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
      <div className="entity-list">
        {sorted.map((item) => (
          <div key={item.id} className="entity-item">
            <div
              className="entity-header"
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            >
              <span className="entity-name">{item.name}</span>
              <span className="entity-meta">{item.gold.total}g</span>
            </div>
            {expanded === item.id && (
              <div className="entity-details">
                <p>{item.description}</p>
                {item.plaintext && (
                  <p className="entity-title">{item.plaintext}</p>
                )}
                <div className="stat-grid">
                  {Object.entries(item.stats).map(([stat, val]) => (
                    <span key={stat}>
                      {stat}: {val}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
