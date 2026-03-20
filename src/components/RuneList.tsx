import { useState } from "react";
import type { RuneTree, Rune } from "../lib/data-ingest/types";

interface RuneListProps {
  runes: RuneTree[];
}

export function RuneList({ runes }: RuneListProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="entity-list">
      {runes.map((tree) => (
        <div key={tree.id} className="entity-item">
          <div
            className="entity-header"
            onClick={() => setExpanded(expanded === tree.id ? null : tree.id)}
          >
            <span className="entity-name">{tree.name}</span>
            <span className="entity-meta">
              {tree.keystones.length} keystones
            </span>
          </div>
          {expanded === tree.id && (
            <div className="entity-details">
              <p className="entity-title">Keystones</p>
              {tree.keystones.map((rune) => (
                <RuneEntry key={rune.id} rune={rune} />
              ))}
              {tree.slots.map((slot, i) => (
                <div key={i}>
                  <p className="entity-title">Row {i + 1}</p>
                  {slot.map((rune) => (
                    <RuneEntry key={rune.id} rune={rune} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RuneEntry({ rune }: { rune: Rune }) {
  return (
    <div className="rune-entry">
      <span className="entity-name">{rune.name}</span>
      <p>{rune.shortDesc}</p>
    </div>
  );
}
