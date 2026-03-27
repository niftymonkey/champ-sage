import { useState, useCallback, useRef, useEffect } from "react";
import type {
  CoachingResponse,
  CoachingContext,
  CoachingExchange,
  CoachingQuery,
  CoachingItem,
} from "../lib/ai/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { getCoachingResponse } from "../lib/ai/recommendation-engine";
import { playerIntent$, manualInput$, debugInput$ } from "../lib/reactive";

interface CoachingInputProps {
  context: CoachingContext | null;
  gameData: LoadedGameData;
}

function extractAugmentOptions(
  question: string,
  gameData: LoadedGameData
): CoachingQuery["augmentOptions"] {
  const matches = gameData.dictionary.findInText(question);
  const augmentMatches = matches.filter((m) => m.type === "augment");

  if (augmentMatches.length === 0) return undefined;

  const options: NonNullable<CoachingQuery["augmentOptions"]> = [];
  for (const match of augmentMatches) {
    const augment = gameData.augments.get(match.name.toLowerCase());
    if (augment) {
      options.push({
        name: augment.name,
        description: augment.description,
        tier: augment.tier,
        sets: augment.sets,
      });
    }
  }

  return options.length > 0 ? options : undefined;
}

export function CoachingInput({ context, gameData }: CoachingInputProps) {
  const [loading, setLoading] = useState(false);
  const [latestExchange, setLatestExchange] = useState<{
    question: string;
    response: CoachingResponse;
  } | null>(null);
  const [exchanges, setExchanges] = useState<CoachingExchange[]>([]);
  const [chosenAugments, setChosenAugments] = useState<CoachingItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef(context);
  const exchangesRef = useRef(exchanges);
  const gameDataRef = useRef(gameData);
  const chosenAugmentsRef = useRef(chosenAugments);
  contextRef.current = context;
  exchangesRef.current = exchanges;
  gameDataRef.current = gameData;
  chosenAugmentsRef.current = chosenAugments;

  const apiKey =
    import.meta.env.VITE_OPENROUTER_API_KEY ??
    import.meta.env.VITE_OPENAI_API_KEY;

  console.log(
    "[coaching] Component render. context:",
    !!context,
    "apiKey:",
    !!apiKey
  );

  const submitQuestion = useCallback(
    async (question: string) => {
      console.log("[coaching] submitQuestion called:", question);
      console.log("[coaching] contextRef.current:", !!contextRef.current);
      console.log("[coaching] apiKey:", !!apiKey);

      if (!contextRef.current || !apiKey || !question.trim()) {
        const reason = !contextRef.current
          ? "no context"
          : !apiKey
            ? "no API key"
            : "empty question";
        console.log("[coaching] SKIPPED:", reason);
        debugInput$.next({
          source: "llm",
          summary: `Coaching skipped: ${reason}`,
        });
        return;
      }

      const selectionPattern =
        /i (?:chose|picked|took|selected|went with)\s+(.+)/i;
      const selectionMatch = question.match(selectionPattern);
      if (selectionMatch) {
        const mentioned = gameDataRef.current.dictionary
          .findInText(selectionMatch[1])
          .filter((m) => m.type === "augment");
        if (mentioned.length > 0) {
          const newAugmentName = mentioned[0].name;
          const augmentData = gameDataRef.current.augments.get(
            newAugmentName.toLowerCase()
          );
          const newAugment: CoachingItem = {
            name: newAugmentName,
            description: augmentData?.description ?? "",
            sets: augmentData?.sets,
          };
          setChosenAugments((prev) =>
            prev.some((a) => a.name === newAugment.name)
              ? prev
              : [...prev, newAugment]
          );
          if (augmentData) {
            manualInput$.next({ type: "augment", augment: augmentData });
          }
          debugInput$.next({
            source: "llm",
            summary: `Augment selected: ${newAugmentName} (total: ${chosenAugmentsRef.current.length + 1})`,
          });
        }
      }

      setLoading(true);
      setError(null);

      const augmentOptions = extractAugmentOptions(
        question,
        gameDataRef.current
      );

      const contextWithAugments = {
        ...contextRef.current,
        currentAugments:
          chosenAugmentsRef.current.length > 0
            ? chosenAugmentsRef.current
            : contextRef.current.currentAugments,
      };

      debugInput$.next({
        source: "llm",
        summary: `Coaching query: "${question}"`,
        detail:
          [
            augmentOptions
              ? `Augment options matched: ${augmentOptions.map((a) => a.name).join(", ")}`
              : null,
            chosenAugmentsRef.current.length > 0
              ? `Known augments: ${chosenAugmentsRef.current.map((a) => a.name).join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n") || undefined,
      });

      try {
        console.log("[coaching] Calling getCoachingResponse...");
        const response = await getCoachingResponse(
          contextWithAugments,
          {
            question,
            history: exchangesRef.current,
            augmentOptions,
          },
          apiKey
        );
        console.log(
          "[coaching] Response received:",
          response.answer.substring(0, 80)
        );
        setLatestExchange({ question, response });
        setExchanges((prev) => [
          ...prev,
          { question, answer: response.answer },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Request failed";
        console.error("[coaching] ERROR:", msg);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [apiKey]
  );

  useEffect(() => {
    console.log("[coaching] Subscribing to playerIntent$");
    const sub = playerIntent$.subscribe((event) => {
      console.log(
        "[coaching] playerIntent$ event:",
        event.type,
        event.type === "query" ? event.text : ""
      );
      if (event.type === "query" && event.text.trim()) {
        debugInput$.next({
          source: "voice",
          summary: `Voice transcript received by coaching: "${event.text}"`,
        });
        submitQuestion(event.text);
      }
    });
    return () => sub.unsubscribe();
  }, [submitQuestion]);

  if (!apiKey) {
    console.log("[coaching] No API key, showing setup message");
    return (
      <div className="coaching-display">
        <p className="entity-meta">
          Set VITE_OPENAI_API_KEY or VITE_OPENROUTER_API_KEY in .env to enable
          AI coaching.
        </p>
      </div>
    );
  }

  if (!context) {
    console.log("[coaching] No context, rendering null");
    return null;
  }

  return (
    <div className="coaching-display">
      {loading && <p className="coaching-thinking">Thinking...</p>}

      {error && <p className="error">{error}</p>}

      {!loading && latestExchange && (
        <div className="coaching-latest">
          <p className="coaching-question">
            <span className="coaching-label">You:</span>{" "}
            {latestExchange.question}
          </p>
          <p className="coaching-answer">
            <span className="coaching-label">Coach:</span>{" "}
            {latestExchange.response.answer}
          </p>
          {latestExchange.response.recommendations.length > 0 && (
            <div className="coaching-picks">
              {latestExchange.response.recommendations.map((rec, i) => (
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
        </div>
      )}

      {!loading && !latestExchange && (
        <p className="coaching-placeholder">
          Hold Num- and speak to ask your coach
        </p>
      )}
    </div>
  );
}
