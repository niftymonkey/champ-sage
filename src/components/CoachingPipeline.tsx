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
import type { CoachingQuery, CoachingResponse } from "../lib/ai/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { GameState } from "../lib/game-state/types";
import type { ConversationSession } from "../lib/ai/conversation-session";
import {
  buildGamePlanQuestion,
  extractBuildPath,
  isUpdatePlanCommand,
} from "../lib/ai/game-plan-query";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { createConversationSession } from "../lib/ai/conversation-session";
import { coachingFeature } from "../lib/ai/features/coaching";
import { buildGameSystemPrompt } from "../lib/ai/prompts";
import {
  takeGameSnapshot,
  formatStateSnapshot,
} from "../lib/ai/state-formatter";
import { formatAugmentOfferLines } from "../lib/ai/augment-offer-formatter";
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
  const gamePlanFiredRef = useRef(false);
  const lastAugmentResponseRef = useRef<CoachingResponse | null>(null);

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

    const systemPrompt = buildGameSystemPrompt(
      mode,
      gameDataRef.current,
      gameState
    );
    sessionRef.current = createConversationSession(systemPrompt, apiKey);
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
      if (!sessionRef.current || !apiKey) return;

      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );
      const stateText = snapshot ? formatStateSnapshot(snapshot) : "";

      const planQuestion = buildGamePlanQuestion();

      proactiveLog.info(`Game plan query: "${planQuestion}"`);

      const response = await sessionRef.current.ask(coachingFeature, {
        stateSnapshot: stateText,
        question: planQuestion,
      });

      const buildPath = extractBuildPath(response);

      // Smoke check: the prompt asks for 6 items. Anything else is a
      // catastrophic prompt/schema failure worth surfacing loudly until
      // proper eval coverage lands with the per-feature refactor (#108).
      // A degraded plan (3-5 valid items) is still more useful to the
      // player than an error, so don't abort — surface via warn log.
      if (buildPath.length !== 6) {
        proactiveLog.warn(
          `Game plan build path has ${buildPath.length} items (expected 6)`
        );
      }

      // Fold the (possibly synthesized) buildPath back into the response
      // so the UI and overlay see a normalized version even when the LLM
      // omitted buildPath and we promoted from recommendations.
      const planResponse: CoachingResponse = { ...response, buildPath };

      proactiveLog.info(
        `Game plan response: ${planResponse.answer.substring(0, 200)}...`
      );
      proactiveLog.info(
        `Game plan build path: ${buildPath
          .map((i) => `${i.name} [${i.category}]`)
          .join(" → ")}`
      );

      pushGamePlan(planResponse.answer, buildPath, gameTime);

      // Relay to overlay
      proactiveLog.info("Sending game plan response to overlay");
      window.electronAPI?.sendCoachingResponse({
        ...planResponse,
        source: "plan",
        sentAt: Date.now(),
      });
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

      // Build state snapshot
      const snapshot = takeGameSnapshot(
        liveGameStateRef.current,
        enemyStatsRef.current,
        gameDataRef.current,
        chosenAugmentsRef.current
      );
      const stateText = snapshot ? formatStateSnapshot(snapshot) : "";

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

      const isAugmentQuery = question.startsWith(
        "I'm being offered these augments:"
      );
      const source = isAugmentQuery ? "augment" : "reactive";

      if (source === "reactive") {
        window.electronAPI?.sendCoachingRequest();
      }

      try {
        const response = await sessionRef.current.ask(
          coachingFeature,
          { stateSnapshot: stateText, question: questionText },
          { signal: options?.signal }
        );

        // Pin fit ratings for augments that carried over from a reroll.
        // An augment's fit is about the augment vs. the player's state, not
        // vs. the other options — so if it was already rated, keep that rating.
        let finalResponse = response;
        if (isAugmentQuery && lastAugmentResponseRef.current) {
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
          finalResponse = { ...response, recommendations: merged };
        }
        if (isAugmentQuery) {
          lastAugmentResponseRef.current = finalResponse;
        }

        // Push to coaching feed (both reactive and augment queries)
        const gameTime = liveGameStateRef.current.gameTime;
        const feedSource = isAugmentQuery ? "augment" : "voice";
        pushCoachingExchange(
          question,
          finalResponse.answer,
          finalResponse.recommendations.map((r) => ({
            name: r.name,
            fit: r.fit,
            reasoning: r.reasoning,
          })),
          gameTime,
          feedSource,
          finalResponse.retried ?? false
        );

        // Relay to overlay
        const sentAt = Date.now();
        const overlayPayload = {
          ...finalResponse,
          source,
          sentAt,
        };
        reactiveLog.info(
          `Sending coaching response to overlay (source=${source})`,
          {
            sentAt,
            hasAnswer: !!overlayPayload.answer,
            answerLength: overlayPayload.answer?.length ?? 0,
            recNames: overlayPayload.recommendations?.map(
              (r: { name: string }) => r.name
            ),
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

          const question = `I'm being offered these augments: ${names.join(", ")}. How well does each fit my current build?`;
          proactiveLog.info(
            `Auto-querying coaching for augment offer: ${names.join(", ")}`
          );

          // submitQuestion handles the LLM call and overlay relay.
          // We need to update the feed entry with real rankings after.
          await submitQuestion(question, { signal });

          // Update the feed entry with coaching response rankings
          const feed = coachingFeed$.getValue();
          // The last coaching-exchange entry (if present) has the response
          const lastVoice = [...feed]
            .reverse()
            .find((e) => e.type === "coaching-exchange") as
            | CoachingExchangeEntry
            | undefined;
          if (lastVoice) {
            // Update the augment offer entry with LLM fit ratings
            const updated = feed.map((e) => {
              if (e.id !== entry.id || e.type !== "augment-offer") return e;
              const ratedOptions = names.map((name) => {
                const rec = lastVoice.recommendations.find(
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
          }
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
  }, [submitQuestion]);

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
