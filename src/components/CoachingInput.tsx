import { useState, useCallback, useRef, useEffect } from "react";
import type { CoachingResponse, CoachingQuery } from "../lib/ai/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { GameState } from "../lib/game-state/types";
import type { ConversationSession } from "../lib/ai/conversation-session";
import type { CoachingFeature } from "../lib/ai/feature";
import type { CoachingFeatureInput } from "../lib/ai/features/coaching";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { createConversationSession } from "../lib/ai/conversation-session";
import { createCoachingFeature } from "../lib/ai/features/coaching";
import { buildBaseContext } from "../lib/ai/base-context";
import {
  takeGameSnapshot,
  formatStateSnapshot,
} from "../lib/ai/state-formatter";
import { formatAugmentOfferLines } from "../lib/ai/augment-offer-formatter";
import { playerIntent$, manualInput$ } from "../lib/reactive";
import { augmentOffer$, augmentPicked$ } from "../lib/reactive/gep-bridge";
import { createAugmentCoachingController } from "../lib/ai/augment-coaching";
import { getLogger } from "../lib/logger";

const reactiveLog = getLogger("coaching:reactive");
const proactiveLog = getLogger("coaching:proactive");

interface CoachingInputProps {
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

export function CoachingInput({ gameData }: CoachingInputProps) {
  const liveGameState = useLiveGameState();
  const { mode, enemyStats } = useCoachingContext();
  const [loading, setLoading] = useState(false);
  const [latestExchange, setLatestExchange] = useState<{
    question: string;
    response: CoachingResponse;
  } | null>(null);
  const [chosenAugments, setChosenAugments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for stable access in callbacks
  const liveGameStateRef = useRef(liveGameState);
  const gameDataRef = useRef(gameData);
  const modeRef = useRef(mode);
  const enemyStatsRef = useRef(enemyStats);
  const chosenAugmentsRef = useRef(chosenAugments);
  const sessionRef = useRef<ConversationSession | null>(null);
  const featureRef = useRef<CoachingFeature<
    CoachingFeatureInput,
    CoachingResponse
  > | null>(null);

  liveGameStateRef.current = liveGameState;
  gameDataRef.current = gameData;
  modeRef.current = mode;
  enemyStatsRef.current = enemyStats;
  chosenAugmentsRef.current = chosenAugments;

  const apiKey =
    import.meta.env.VITE_OPENROUTER_API_KEY ??
    import.meta.env.VITE_OPENAI_API_KEY;

  // Create/reset conversation session when mode changes (new game detected)
  useEffect(() => {
    if (!mode || !liveGameState.activePlayer || !apiKey) {
      sessionRef.current = null;
      return;
    }

    // Build the game state for the system prompt
    const gameState: GameState = {
      status: "connected",
      activePlayer: liveGameState.activePlayer,
      players: liveGameState.players,
      gameMode: liveGameState.gameMode,
      gameTime: liveGameState.gameTime,
    };

    const baseContext = buildBaseContext({ mode, gameData, gameState });
    sessionRef.current = createConversationSession(baseContext, apiKey);
    featureRef.current = createCoachingFeature(mode);
    setChosenAugments([]);
    setLatestExchange(null);
    setError(null);

    reactiveLog.info(
      `Conversation session created for ${mode.displayName} | ${liveGameState.activePlayer.championName}`
    );
  }, [apiKey, mode, gameData, liveGameState.activePlayer?.championName]);

  const submitQuestion = useCallback(
    async (question: string, options?: { signal?: AbortSignal }) => {
      if (
        !sessionRef.current ||
        !featureRef.current ||
        !apiKey ||
        !question.trim()
      ) {
        const reason = !sessionRef.current
          ? "no session"
          : !featureRef.current
            ? "no feature"
            : !apiKey
              ? "no API key"
              : "empty question";
        reactiveLog.warn(`Coaching skipped: ${reason}`);
        return;
      }

      // Track augment selections from voice input ("I chose X")
      const selectionPattern =
        /i (?:chose|picked|took|selected|went with)\s+(.+)/i;
      const selectionMatch = question.match(selectionPattern);
      if (selectionMatch) {
        const mentioned = gameDataRef.current.dictionary
          .findInText(selectionMatch[1])
          .filter((m) => m.type === "augment");
        if (mentioned.length > 0) {
          const newAugmentName = mentioned[0].name;
          if (!chosenAugmentsRef.current.includes(newAugmentName)) {
            const next = [...chosenAugmentsRef.current, newAugmentName];
            chosenAugmentsRef.current = next;
            setChosenAugments(next);
            const augmentData = gameDataRef.current.augments.get(
              newAugmentName.toLowerCase()
            );
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

      // Build state snapshot from current game state
      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );
      const stateText = snapshot ? formatStateSnapshot(snapshot) : "";

      // Build the question text, appending augment options if detected
      const augmentOptions = extractAugmentOptions(
        question,
        gameDataRef.current
      );
      let questionText = question;
      if (augmentOptions && augmentOptions.length > 0) {
        const augmentLines = formatAugmentOfferLines(
          augmentOptions,
          chosenAugmentsRef.current,
          gameDataRef.current
        );
        questionText = `${question}\n\nAugment options:\n${augmentLines.join("\n")}`;
      }

      reactiveLog.info(
        `Coaching query: "${question}" | ${sessionRef.current.messages.length} messages in thread`
      );

      // Determine source for overlay routing
      const isAugmentQuery = question.startsWith(
        "I'm being offered these augments:"
      );
      const source = isAugmentQuery ? "augment" : "reactive";

      if (source === "reactive") {
        window.electronAPI?.sendCoachingRequest();
      }

      try {
        const response = await sessionRef.current.ask(
          featureRef.current,
          { stateSnapshot: stateText, question: questionText },
          { signal: options?.signal }
        );

        setLatestExchange({ question, response });

        // Relay to overlay
        const sentAt = Date.now();
        reactiveLog.info(
          `Sending coaching response to overlay (source=${source}, sentAt=${sentAt})`
        );
        window.electronAPI?.sendCoachingResponse({
          ...response,
          source,
          sentAt,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          reactiveLog.debug("Coaching request cancelled");
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

  // GEP augment coaching controller
  useEffect(() => {
    const ctrl = createAugmentCoachingController(
      augmentOffer$,
      augmentPicked$,
      {
        submitQuery: async (names, signal) => {
          const question = `I'm being offered these augments: ${names.join(", ")}. How well does each fit my current build?`;
          proactiveLog.info(
            `Auto-querying coaching for augment offer: ${names.join(", ")}`
          );
          await submitQuestion(question, { signal });
        },
        onPicked: (name) => {
          if (chosenAugmentsRef.current.includes(name)) return;
          const next = [...chosenAugmentsRef.current, name];
          chosenAugmentsRef.current = next;
          setChosenAugments(next);
          const augmentData = gameDataRef.current.augments.get(
            name.toLowerCase()
          );
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
              {latestExchange.response.recommendations.map((rec) => (
                <div key={rec.name} className="coaching-pick">
                  <span
                    className={`coaching-pick-rank coaching-fit-${rec.fit}`}
                  >
                    {rec.fit}
                  </span>
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

      {!loading && !latestExchange && !liveGameState.activePlayer && (
        <p className="coaching-placeholder">Waiting for game...</p>
      )}

      {!loading && !latestExchange && liveGameState.activePlayer && (
        <p className="coaching-placeholder">
          Hold Num- and speak to ask your coach
        </p>
      )}
    </div>
  );
}
