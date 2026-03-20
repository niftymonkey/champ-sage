import { useState } from "react";
import type { LoadedGameData } from "../lib/data-ingest";
import type { EntityMatch } from "../lib/data-ingest/types";

interface EntitySearchProps {
  data: LoadedGameData;
}

export function EntitySearch({ data }: EntitySearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityMatch[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  function handleSearch(value: string) {
    setQuery(value);
    setExpanded(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setResults(data.dictionary.search(value.trim()).slice(0, 20));
  }

  function toggleExpand(key: string) {
    setExpanded(expanded === key ? null : key);
  }

  return (
    <div>
      <input
        type="text"
        placeholder="Search champions, items, augments..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        className="search-input"
      />
      {results.length > 0 && (
        <div className="entity-list">
          {results.map((match) => {
            const key = `${match.type}-${match.name}`;
            return (
              <div key={key} className="entity-item">
                <div
                  className="entity-header"
                  onClick={() => toggleExpand(key)}
                >
                  <span className="entity-name">{match.name}</span>
                  <span className="entity-meta">
                    {match.type} | score: {match.score.toFixed(2)}
                  </span>
                </div>
                {expanded === key && renderDetails(match, data)}
              </div>
            );
          })}
        </div>
      )}
      {query.trim().length >= 2 && results.length === 0 && (
        <p>No matches found.</p>
      )}
    </div>
  );
}

function renderDetails(match: EntityMatch, data: LoadedGameData) {
  switch (match.type) {
    case "champion": {
      const champ = data.champions.get(match.name.toLowerCase());
      if (!champ) return null;
      return (
        <div className="entity-details">
          <p>
            {champ.title} — {champ.tags.join(", ")} ({champ.partype})
          </p>
          <div className="stats-grid">
            <span>HP: {champ.stats.hp}</span>
            <span>AD: {champ.stats.attackdamage}</span>
            <span>Armor: {champ.stats.armor}</span>
            <span>MR: {champ.stats.spellblock}</span>
            <span>MS: {champ.stats.movespeed}</span>
            <span>Range: {champ.stats.attackrange}</span>
          </div>
        </div>
      );
    }
    case "item": {
      const item = [...data.items.values()].find((i) => i.name === match.name);
      if (!item) return null;
      return (
        <div className="entity-details">
          <p>{item.description}</p>
          <p className="entity-meta">
            {item.gold.total}g | {item.mode}
          </p>
        </div>
      );
    }
    case "augment": {
      const aug = data.augments.get(match.name.toLowerCase());
      if (!aug) return null;
      return (
        <div className="entity-details">
          {aug.description && <p>{aug.description}</p>}
          {aug.sets.length > 0 && (
            <p className="entity-title">Sets: {aug.sets.join(", ")}</p>
          )}
          <p className="entity-meta">
            {aug.tier} | {aug.mode}
            {aug.id != null ? ` | ID: ${aug.id}` : ""}
          </p>
        </div>
      );
    }
  }
}
