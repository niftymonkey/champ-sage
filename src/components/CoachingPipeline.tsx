/**
 * Headless component that manages the coaching pipeline.
 *
 * Handles conversation sessions, voice intent subscription, GEP augment
 * coaching, and the "update game plan" voice command. Pushes results
 * into coachingFeed$ and gamePlan$ rather than rendering its own UI.
 *
 * Must be mounted inside CoachingProvider.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { LoadedGameData } from "../lib/data-ingest";
import type { GameState } from "../lib/game-state/types";
import type { ConversationSession } from "../lib/ai/conversation-session";
import type { CoachingFeature } from "../lib/ai/feature";
import {
  createGamePlanFeature,
  extractBuildPath,
  isUpdatePlanCommand,
  type GamePlanInput,
  type GamePlanResult,
} from "../lib/ai/features/game-plan";
import {
  augmentFitFeature,
  type AugmentFitResult,
} from "../lib/ai/features/augment-fit";
import { voiceQueryFeature } from "../lib/ai/features/voice-query";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { createConversationSession } from "../lib/ai/conversation-session";
import { buildBaseContext } from "../lib/ai/base-context";
import { takeGameSnapshot } from "../lib/ai/state-formatter";
import { playerIntent$, manualInput$ } from "../lib/reactive";
import { augmentOffer$, augmentPicked$ } from "../lib/reactive/gep-bridge";
import { createAugmentCoachingController } from "../lib/ai/augment-coaching";
import {
  coachingFeed$,
  gamePlan$,
  pushGamePlan,
  pushAugmentOffer,
  pushCoachingExchange,
  captureLastGameSnapshot,
  resetForNewGame,
} from "../lib/reactive/coaching-feed";
import type { CoachingExchangeEntry } from "../lib/reactive/coaching-feed-types";
import { getLogger } from "../lib/logger";

const reactiveLog = getLogger("coaching:reactive");
const proactiveLog = getLogger("coaching:proactive");

interface CoachingPipelineProps {
  gameData: LoadedGameData;
}

export function CoachingPipeline({ gameData }: CoachingPipelineProps) {
  const liveGameState = useLiveGameState();
  const { mode, enemyStats } = useCoachingContext();
  const [chosenAugments, setChosenAugments] = useState<string[]>([]);
  const wasInGameRef = useRef(false);
  // Capture last known in-game state for end-of-game snapshot.
  // liveGameState may reset before the snapshot effect fires.
  const lastInGameStateRef = useRef(liveGameState);

  const liveGameStateRef = useRef(liveGameState);
  const gameDataRef = useRef(gameData);
  const modeRef = useRef(mode);
  const enemyStatsRef = useRef(enemyStats);
  const chosenAugmentsRef = useRef(chosenAugments);
  const sessionRef = useRef<ConversationSession | null>(null);
  const gamePlanFeatureRef = useRef<CoachingFeature<
    GamePlanInput,
    GamePlanResult
  > | null>(null);
  const gamePlanFiredRef = useRef(false);
  const lastAugmentResponseRef = useRef<AugmentFitResult | null>(null);

  liveGameStateRef.current = liveGameState;
  if (liveGameState.activePlayer) {
    lastInGameStateRef.current = liveGameState;
  }
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

    const baseContext = buildBaseContext({
      mode,
      gameData: gameDataRef.current,
      gameState,
    });
    sessionRef.current = createConversationSession(baseContext, apiKey);
    gamePlanFeatureRef.current = createGamePlanFeature(gameDataRef.current);
    setChosenAugments([]);
    gamePlanFiredRef.current = false;
    resetForNewGame();

    reactiveLog.info(
      `Conversation session created for ${mode.displayName} | ${liveGameState.activePlayer.championName}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gameData excluded
    // intentionally: background data refresh should NOT reset the mid-game
    // conversation session. gameDataRef.current provides the latest data
    // without triggering a session reset.
  }, [apiKey, mode, liveGameState.activePlayer?.championName]);

  // Capture last game snapshot when transitioning out of a game
  useEffect(() => {
    const inGame = liveGameState.activePlayer !== null;

    if (inGame) {
      wasInGameRef.current = true;
      return;
    }

    if (!wasInGameRef.current) return;
    wasInGameRef.current = false;

    // Game just ended — capture snapshot using last known in-game state
    // (current liveGameState may already be reset)
    const lastState = lastInGameStateRef.current;
    const feed = coachingFeed$.getValue();
    const activeInfo = lastState.players.find((p) => p.isActivePlayer);
    const eog = liveGameState.eogStats ?? lastState.eogStats;

    // Extract last 3 coaching exchanges for the idle card
    const voiceEntries = feed.filter(
      (e): e is CoachingExchangeEntry => e.type === "coaching-exchange"
    );
    const recentExchanges = voiceEntries.slice(-3).map((e) => ({
      question: e.question,
      answer: e.answer,
    }));

    captureLastGameSnapshot({
      championName:
        activeInfo?.championName ??
        lastState.activePlayer?.championName ??
        "Unknown",
      isWin: eog?.isWin ?? false,
      kills: activeInfo?.kills ?? 0,
      deaths: activeInfo?.deaths ?? 0,
      assists: activeInfo?.assists ?? 0,
      gameTime: eog?.gameLength ?? lastState.gameTime,
      gameMode: lastState.gameMode || eog?.gameMode || "",
      items: activeInfo?.items.map((i) => i.name) ?? [],
      augments: chosenAugmentsRef.current,
      recentExchanges,
    });

    reactiveLog.info("Last game snapshot captured");
  }, [liveGameState.activePlayer]);

  // Auto-generate opening game plan once first full data arrives
  useEffect(() => {
    if (
      !sessionRef.current ||
      !apiKey ||
      gamePlanFiredRef.current ||
      !liveGameState.activePlayer ||
      liveGameState.players.length === 0
    ) {
      return;
    }

    gamePlanFiredRef.current = true;
    const gameTime = liveGameState.gameTime;

    proactiveLog.info("Generating opening game plan");

    submitGamePlanQuery(gameTime).catch((err) => {
      proactiveLog.error(`Opening game plan failed: ${err}`);
    });
  }, [apiKey, liveGameState.activePlayer, liveGameState.players.length]);

  const submitGamePlanQuery = useCallback(
    async (gameTime: number) => {
      if (!sessionRef.current || !gamePlanFeatureRef.current || !apiKey) return;

      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );

      proactiveLog.info("Game plan query");

      const { value: response } = await sessionRef.current.ask(
        gamePlanFeatureRef.current,
        { snapshot }
      );

      const buildPath = extractBuildPath(response);

      // Smoke check: the schema requires 6 items. Fewer indicates a
      // degraded-mode path (item-catalog exceeded the enum size limit and
      // the schema fell back to free-string names) — still useful to the
      // player but worth a warn log.
      if (buildPath.length !== 6) {
        proactiveLog.warn(
          `Game plan build path has ${buildPath.length} items (expected 6)`
        );
      }

      proactiveLog.info(
        `Game plan response: ${response.answer.substring(0, 200)}...`
      );
      proactiveLog.info(
        `Game plan build path: ${buildPath
          .map((i) => `${i.name} [${i.category}]`)
          .join(" → ")}`
      );

      pushGamePlan(response.answer, buildPath, gameTime);

      // Relay to overlay. Overlay's CoachingResponse shape wants
      // recommendations + buildPath even when the feature doesn't use
      // recommendations (empty array here).
      proactiveLog.info("Sending game plan response to overlay");
      window.electronAPI?.sendCoachingResponse({
        answer: response.answer,
        recommendations: [],
        buildPath,
        source: "plan",
        sentAt: Date.now(),
      });
    },
    [apiKey]
  );

  const submitAugmentQuery = useCallback(
    async (
      names: string[],
      options?: { signal?: AbortSignal }
    ): Promise<AugmentFitResult | null> => {
      if (!sessionRef.current || !apiKey) {
        reactiveLog.warn(
          `Augment query skipped: ${!sessionRef.current ? "no session" : "no API key"}`
        );
        return null;
      }

      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );

      proactiveLog.info(
        `Auto-querying coaching for augment offer: ${names.join(", ")}`
      );

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

        // Pin fit ratings for augments that carried over from a reroll.
        // An augment's fit is about the augment vs. the player's state, not
        // vs. the other options — so if it was already rated, keep that rating.
        let finalResult: AugmentFitResult = response;
        if (lastAugmentResponseRef.current) {
          const prevByName = new Map(
            lastAugmentResponseRef.current.recommendations.map((r) => [
              r.name.toLowerCase(),
              r,
            ])
          );
          const merged = response.recommendations.map((rec) => {
            const prior = prevByName.get(rec.name.toLowerCase());
            return prior ?? rec;
          });
          finalResult = { recommendations: merged };
        }
        lastAugmentResponseRef.current = finalResult;

        const gameTime = liveGameStateRef.current.gameTime;
        const question = `I'm being offered these augments: ${names.join(", ")}. How well does each fit my current build?`;
        pushCoachingExchange(
          question,
          "", // augment-fit has no prose answer; UI renders badges only
          finalResult.recommendations.map((r) => ({
            name: r.name,
            fit: r.fit,
            reasoning: r.reasoning,
          })),
          gameTime,
          "augment",
          retried
        );

        const sentAt = Date.now();
        const overlayPayload = {
          answer: "",
          recommendations: finalResult.recommendations,
          buildPath: null,
          retried,
          source: "augment" as const,
          sentAt,
        };
        reactiveLog.info(
          "Sending coaching response to overlay (source=augment)",
          {
            sentAt,
            recNames: overlayPayload.recommendations.map((r) => r.name),
          }
        );
        window.electronAPI?.sendCoachingResponse(overlayPayload);

        return finalResult;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          reactiveLog.debug("Augment request cancelled");
        } else {
          const msg = err instanceof Error ? err.message : "Request failed";
          reactiveLog.error(`Augment coaching error: ${msg}`);
        }
        return null;
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

      // Check for "update game plan" voice command
      const trimmedQuestion = question.trim();
      const isUpdatePlan = isUpdatePlanCommand(trimmedQuestion);
      proactiveLog.info(
        `Voice intent match: "${trimmedQuestion}" → updatePlan=${isUpdatePlan}`
      );
      if (isUpdatePlan) {
        proactiveLog.info("Voice command: update game plan");
        const gameTime = liveGameStateRef.current.gameTime;
        try {
          await submitGamePlanQuery(gameTime);
          // Also push as a coaching exchange for the feed narrative
          const plan = gamePlan$.getValue();
          if (plan) {
            pushCoachingExchange(
              question,
              plan.summary,
              plan.buildPath.map((item) => ({
                name: item.name,
                fit: "strong" as const,
                reasoning: item.reason,
              })),
              gameTime,
              "plan"
            );
          }
        } catch (err) {
          if (err instanceof Error && err.name !== "AbortError") {
            reactiveLog.error(`Update game plan failed: ${err}`);
          }
        }
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

      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );

      window.electronAPI?.sendCoachingRequest();

      try {
        const { value: response, retried } = await sessionRef.current.ask(
          voiceQueryFeature,
          { snapshot, question },
          { signal: options?.signal }
        );

        const gameTime = liveGameStateRef.current.gameTime;
        pushCoachingExchange(
          question,
          response.answer,
          response.recommendations.map((r) => ({
            name: r.name,
            fit: r.fit,
            reasoning: r.reasoning,
          })),
          gameTime,
          "voice",
          retried
        );

        const sentAt = Date.now();
        const overlayPayload = {
          answer: response.answer,
          recommendations: response.recommendations,
          buildPath: null,
          retried,
          source: "reactive" as const,
          sentAt,
        };
        reactiveLog.info(
          "Sending coaching response to overlay (source=reactive)",
          {
            sentAt,
            hasAnswer: !!overlayPayload.answer,
            recNames: overlayPayload.recommendations.map((r) => r.name),
          }
        );
        window.electronAPI?.sendCoachingResponse(overlayPayload);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          reactiveLog.debug("Coaching request cancelled");
        } else {
          const msg = err instanceof Error ? err.message : "Request failed";
          reactiveLog.error(`Coaching error: ${msg}`);
        }
      }
    },
    [apiKey, submitGamePlanQuery]
  );

  // Subscribe to voice intent
  useEffect(() => {
    const sub = playerIntent$.subscribe((event) => {
      if (event.type === "query" && event.text.trim()) {
        submitQuestion(event.text);
      }
    });
    return () => sub.unsubscribe();
  }, [submitQuestion]);

  // GEP augment coaching controller — pushes offers into feed
  useEffect(() => {
    const ctrl = createAugmentCoachingController(
      augmentOffer$,
      augmentPicked$,
      {
        submitQuery: async (names, signal) => {
          const gameTime = liveGameStateRef.current.gameTime;

          // Push augment offer to feed with placeholder data
          const entry = pushAugmentOffer(
            names.map((name) => ({
              name,
              fit: "situational" as const,
              reasoning: "",
            })),
            gameTime
          );

          const response = await submitAugmentQuery([...names], { signal });
          if (!response) return;

          // Update the augment-offer feed entry with LLM fit ratings
          const feed = coachingFeed$.getValue();
          const updated = feed.map((e) => {
            if (e.id !== entry.id || e.type !== "augment-offer") return e;
            const ratedOptions = names.map((name) => {
              const rec = response.recommendations.find(
                (r) => r.name.toLowerCase() === name.toLowerCase()
              );
              return {
                name,
                fit: rec?.fit ?? ("situational" as const),
                reasoning: rec?.reasoning ?? "",
              };
            });
            return { ...e, options: ratedOptions };
          });
          coachingFeed$.next(updated);
        },
        onPicked: (name) => {
          // Clear pinned ratings — next offer is a fresh selection round
          lastAugmentResponseRef.current = null;
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

  // Headless — no UI output
  return null;
}
