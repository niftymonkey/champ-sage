import { useState, useCallback, useRef } from "react";
import type {
  CoachingResponse,
  CoachingContext,
  CoachingExchange,
} from "../lib/ai/types";
import { getCoachingResponse } from "../lib/ai/recommendation-engine";

interface CoachingInputProps {
  context: CoachingContext | null;
}

export function CoachingInput({ context }: CoachingInputProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [exchanges, setExchanges] = useState<CoachingExchange[]>([]);
  const [latestResponse, setLatestResponse] = useState<CoachingResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!context || !apiKey || !query.trim()) return;

      const question = query.trim();
      setLoading(true);
      setError(null);
      setQuery("");

      try {
        const response = await getCoachingResponse(
          context,
          { question, history: exchanges },
          apiKey
        );
        setLatestResponse(response);
        setExchanges((prev) => [
          ...prev,
          { question, answer: response.answer },
        ]);
        setTimeout(
          () => scrollRef.current?.scrollIntoView({ behavior: "smooth" }),
          50
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [context, apiKey, query, exchanges]
  );

  if (!apiKey) {
    return (
      <div className="coaching-input">
        <p className="entity-meta">
          Set VITE_OPENAI_API_KEY in .env to enable AI coaching.
        </p>
      </div>
    );
  }

  if (!context) {
    return null;
  }

  return (
    <div className="coaching-input">
      {exchanges.length > 0 && (
        <div className="coaching-history">
          {exchanges.map((ex, i) => (
            <div key={i} className="coaching-exchange">
              <p className="coaching-question">
                <span className="coaching-label">You:</span> {ex.question}
              </p>
              <p className="coaching-answer">
                <span className="coaching-label">Coach:</span> {ex.answer}
              </p>
            </div>
          ))}
        </div>
      )}

      {latestResponse &&
        latestResponse.recommendations.length > 0 &&
        !loading && (
          <div className="coaching-picks">
            {latestResponse.recommendations.map((rec, i) => (
              <div key={rec.name} className="coaching-pick">
                <span className="coaching-pick-rank">#{i + 1}</span>
                <div className="coaching-pick-content">
                  <span className="entity-name">{rec.name}</span>
                  <p className="entity-meta">{rec.reasoning}</p>
                </div>
              </div>
            ))}
          </div>
        )}

      {error && <p className="error">{error}</p>}

      <form onSubmit={handleSubmit} className="coaching-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Thinking..." : "Ask your coach..."}
          disabled={loading}
          className="coaching-text-input"
        />
        <button type="submit" disabled={loading || !query.trim()}>
          {loading ? "..." : "Ask"}
        </button>
      </form>
      <div ref={scrollRef} />
    </div>
  );
}
