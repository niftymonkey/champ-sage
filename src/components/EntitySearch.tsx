import { useState } from "react";
import type { EntityDictionary, EntityMatch } from "../lib/data-ingest/types";

interface EntitySearchProps {
  dictionary: EntityDictionary;
}

export function EntitySearch({ dictionary }: EntitySearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityMatch[]>([]);

  function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setResults(dictionary.search(value.trim()).slice(0, 20));
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
          {results.map((match) => (
            <div key={`${match.type}-${match.name}`} className="entity-item">
              <div className="entity-header">
                <span className="entity-name">{match.name}</span>
                <span className="entity-meta">
                  {match.type} | score: {match.score.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && results.length === 0 && (
        <p>No matches found.</p>
      )}
    </div>
  );
}
