import { useState } from "react";
import type { Champion } from "../lib/data-ingest/types";

interface ChampionListProps {
  champions: Map<string, Champion>;
}

export function ChampionList({ champions }: ChampionListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = [...champions.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div className="entity-list">
      {sorted.map((champ) => (
        <div key={champ.id} className="entity-item">
          <div
            className="entity-header"
            onClick={() => setExpanded(expanded === champ.id ? null : champ.id)}
          >
            <span className="entity-name">{champ.name}</span>
            <span className="entity-meta">
              {champ.tags.join(", ")} | {champ.partype}
            </span>
          </div>
          {expanded === champ.id && (
            <div className="entity-details">
              <p className="entity-title">{champ.title}</p>
              <div className="stat-grid">
                <span>HP: {champ.stats.hp}</span>
                <span>AD: {champ.stats.attackdamage}</span>
                <span>Armor: {champ.stats.armor}</span>
                <span>MR: {champ.stats.spellblock}</span>
                <span>AS: {champ.stats.attackspeed}</span>
                <span>Range: {champ.stats.attackrange}</span>
                <span>MS: {champ.stats.movespeed}</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
