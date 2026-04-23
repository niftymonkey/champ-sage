import { useState, useCallback, useRef, useEffect } from "react";
import type { CoachingResponse } from "../lib/ai/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { GameState } from "../lib/game-state/types";
import type { MatchSession } from "../lib/ai/match-session";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { createMatchSession } from "../lib/ai/match-session";
import { augmentFitFeature } from "../lib/ai/features/augment-fit";
import { voiceQueryFeature } from "../lib/ai/features/voice-query";
import { buildBaseContext } from "../lib/ai/base-context";
import { takeGameSnapshot } from "../lib/ai/state-formatter";
import { playerIntent$, manualInput$ } from "../lib/reactive";
import { augmentOffer$, augmentPicked$ } from "../lib/reactive/gep-bridge";
import { createAugmentCoachingController } from "../lib/ai/augment-coaching";
import { getLogger } from "../lib/logger";

const reactiveLog = getLogger("coaching:reactive");
const proactiveLog = getLogger("coaching:proactive");

interface CoachingInputProps {
  gameData: LoadedGameData;
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
  const sessionRef = useRef<MatchSession | null>(null);

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

    const gameState: GameState = {
      status: "connected",
      activePlayer: liveGameState.activePlayer,
      players: liveGameState.players,
      gameMode: liveGameState.gameMode,
      gameTime: liveGameState.gameTime,
    };

    const baseContext = buildBaseContext({ mode, gameData, gameState });
    sessionRef.current = createMatchSession(baseContext, apiKey);
    setChosenAugments([]);
    setLatestExchange(null);
    setError(null);

    reactiveLog.info(
      `Conversation session created for ${mode.displayName} | ${liveGameState.activePlayer.championName}`
    );
  }, [apiKey, mode, gameData, liveGameState.activePlayer?.championName]);

  const submitAugmentQuery = useCallback(
    async (names: string[], options?: { signal?: AbortSignal }) => {
      if (!sessionRef.current || !apiKey) return;

      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );

      proactiveLog.info(
        `Auto-querying coaching for augment offer: ${names.join(", ")}`
      );
      setLoading(true);
      setError(null);

      try {
        const { value: response, retried } = await sessionRef.current.ask(
          augmentFitFeature,
          {
            snapshot,
            augmentNames: names,
            chosenAugments: chosenAugmentsRef.current,
            gameData: gameDataRef.current,
          },
          { signal: options?.signal }
        );

        const question = `I'm being offered these augments: ${names.join(", ")}. How well does each fit my current build?`;
        setLatestExchange({
          question,
          response: {
            answer: "",
            recommendations: response.recommendations,
            buildPath: null,
            retried,
          },
        });

        const sentAt = Date.now();
        reactiveLog.info(
          `Sending coaching response to overlay (source=augment, sentAt=${sentAt})`
        );
        window.electronAPI?.sendCoachingResponse({
          answer: "",
          recommendations: response.recommendations,
          buildPath: null,
          retried,
          source: "augment",
          sentAt,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          reactiveLog.debug("Augment request cancelled");
        } else {
          const msg = err instanceof Error ? err.message : "Request failed";
          reactiveLog.error(`Augment coaching error: ${msg}`);
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [apiKey]
  );

  const submitQuestion = useCallback(
    async (question: string, options?: { signal?: AbortSignal }) => {
      if (!sessionRef.current || !apiKey || !question.trim()) {
        const reason = !sessionRef.current
          ? "no session"
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

      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );

      reactiveLog.info(
        `Coaching query: "${question}" | ${sessionRef.current.messages.length} messages in thread`
      );

      window.electronAPI?.sendCoachingRequest();

      try {
        const { value: response, retried } = await sessionRef.current.ask(
          voiceQueryFeature,
          { snapshot, question },
          { signal: options?.signal }
        );

        setLatestExchange({
          question,
          response: {
            answer: response.answer,
            recommendations: response.recommendations,
            buildPath: null,
            retried,
          },
        });

        const sentAt = Date.now();
        reactiveLog.info(
          `Sending coaching response to overlay (source=reactive, sentAt=${sentAt})`
        );
        window.electronAPI?.sendCoachingResponse({
          answer: response.answer,
          recommendations: response.recommendations,
          buildPath: null,
          retried,
          source: "reactive",
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
          await submitAugmentQuery([...names], { signal });
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
  }, [submitAugmentQuery]);

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
