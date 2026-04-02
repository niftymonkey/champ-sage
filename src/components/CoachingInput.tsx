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
import { playerIntent$, manualInput$ } from "../lib/reactive";
import { augmentOffer$, augmentPicked$ } from "../lib/reactive/gep-bridge";
import { createAugmentCoachingController } from "../lib/ai/augment-coaching";
import { getLogger } from "../lib/logger";

const reactiveLog = getLogger("coaching:reactive");
const proactiveLog = getLogger("coaching:proactive");

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

  const submitQuestion = useCallback(
    async (question: string, options?: { signal?: AbortSignal }) => {
      if (!contextRef.current || !apiKey || !question.trim()) {
        const reason = !contextRef.current
          ? "no context"
          : !apiKey
            ? "no API key"
            : "empty question";
        reactiveLog.warn(`Coaching skipped: ${reason}`);
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
          const alreadySelected = chosenAugmentsRef.current.some(
            (a) => a.name === newAugment.name
          );
          if (!alreadySelected) {
            const next = [...chosenAugmentsRef.current, newAugment];
            chosenAugmentsRef.current = next;
            setChosenAugments(next);
            if (augmentData) {
              manualInput$.next({ type: "augment", augment: augmentData });
            }
            reactiveLog.info(
              `Augment selected: ${newAugmentName} (total: ${next.length})`
            );
          }
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

      reactiveLog.info(`Coaching query: "${question}"`);

      // Determine if this is an augment/shard offer or a voice/reactive query.
      // Auto-generated augment queries always start with this prefix.
      const isAugmentQuery = question.startsWith(
        "I'm being offered these augments:"
      );
      const source = isAugmentQuery ? "augment" : "reactive";

      // Only notify coaching strip for voice/reactive queries
      if (source === "reactive") {
        window.electronAPI?.sendCoachingRequest();
      }

      try {
        const response = await getCoachingResponse(
          contextWithAugments,
          {
            question,
            history: exchangesRef.current,
            augmentOptions,
          },
          apiKey,
          { signal: options?.signal }
        );
        setLatestExchange({ question, response });
        setExchanges((prev) => [
          ...prev,
          { question, answer: response.answer },
        ]);

        // Relay to overlay — tagged with source so badges and strip
        // only display their respective responses
        window.electronAPI?.sendCoachingResponse({ ...response, source });
      } catch (err) {
        // Aborted requests are expected — player picked an augment before
        // the coaching response arrived, so the in-flight request was cancelled
        if (err instanceof Error && err.name === "AbortError") {
          reactiveLog.debug(
            "Coaching request cancelled — player picked before response arrived"
          );
        } else {
          const msg = err instanceof Error ? err.message : "Request failed";
          reactiveLog.error(`Coaching error: ${msg}`);
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [apiKey]
  );

  useEffect(() => {
    const sub = playerIntent$.subscribe((event) => {
      if (event.type === "query" && event.text.trim()) {
        submitQuestion(event.text);
      }
    });
    return () => sub.unsubscribe();
  }, [submitQuestion]);

  // GEP augment coaching controller — handles debouncing, cancellation,
  // and all three staleness scenarios (see augment-coaching.ts for details).
  useEffect(() => {
    const ctrl = createAugmentCoachingController(
      augmentOffer$,
      augmentPicked$,
      {
        submitQuery: async (names, signal) => {
          const question = `I'm being offered these augments: ${names.join(", ")}. Which should I pick and which should I re-roll?`;
          proactiveLog.info(
            `Auto-querying coaching for augment offer: ${names.join(", ")}`
          );
          await submitQuestion(question, { signal });
        },
        onPicked: (name) => {
          if (chosenAugmentsRef.current.some((a) => a.name === name)) return;
          const augmentData = gameDataRef.current.augments.get(
            name.toLowerCase()
          );
          const newAugment: CoachingItem = {
            name,
            description: augmentData?.description ?? "",
            sets: augmentData?.sets,
          };
          const next = [...chosenAugmentsRef.current, newAugment];
          chosenAugmentsRef.current = next;
          setChosenAugments(next);
          if (augmentData) {
            manualInput$.next({ type: "augment", augment: augmentData });
          }
          proactiveLog.info(`Augment added to build: ${name}`);
        },
      }
    );

    return () => ctrl.dispose();
  }, [submitQuestion]);

  useEffect(() => {
    if (!apiKey) {
      reactiveLog.warn(
        "No API key configured. Set VITE_OPENROUTER_API_KEY or VITE_OPENAI_API_KEY in .env"
      );
    }
  }, [apiKey]);

  if (!apiKey) {
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
