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
import type { MatchSession } from "../lib/ai/match-session";
import type { CoachingFeature } from "../lib/ai/feature";
import {
  createGamePlanFeature,
  extractBuildPath,
  findDuplicateBoots,
  isUpdatePlanCommand,
  type GamePlanInput,
  type GamePlanResult,
} from "../lib/ai/features/game-plan";
import {
  augmentFitFeature,
  type AugmentFitResult,
} from "../lib/ai/features/augment-fit";
import {
  isItemRecQuestion,
  itemRecFeature,
  type ItemRecTrigger,
} from "../lib/ai/features/item-rec";
import { voiceQueryFeature } from "../lib/ai/features/voice-query";
import {
  postGameTakeawayFeature,
  type PostGameTakeawayInput,
} from "../lib/ai/features/post-game-takeaway";
import { useCoachingContext } from "../hooks/useCoachingContext";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { createMatchSession } from "../lib/ai/match-session";
import { getPersonality } from "../lib/ai/personality-store";
import { buildBaseContext } from "../lib/ai/base-context";
import { takeGameSnapshot } from "../lib/ai/state-formatter";
import { playerIntent$, manualInput$, liveGameState$ } from "../lib/reactive";
import { augmentOffer$, augmentPicked$ } from "../lib/reactive/gep-bridge";
import { ProactiveEngine } from "../lib/ai/proactive/engine";
import { createAugmentOfferTrigger } from "../lib/ai/proactive/triggers/augment-offer";
import {
  createShopMomentTrigger,
  createGoldAvailableTrigger,
} from "../lib/ai/proactive/triggers/item-purchase";
import type { LiveGameState } from "../lib/reactive/types";
import {
  coachingFeed$,
  gamePlan$,
  pushGamePlan,
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
  const sessionRef = useRef<MatchSession | null>(null);
  const gamePlanFeatureRef = useRef<CoachingFeature<
    GamePlanInput,
    GamePlanResult
  > | null>(null);
  const gamePlanFiredRef = useRef(false);
  // Per-game plan revision counter. Increments each time a plan is sent to
  // the overlay so the slot's plan-revision card chip can show "plan rev N".
  // Reset to 0 alongside resetForNewGame() in the session-create effect.
  const gamePlanRevRef = useRef(0);
  // Per-game synthetic id. The Live Client only exposes gameId via eogStats
  // (end of game), so for the in-game decision-log writes we generate a
  // session id when CoachingPipeline creates the session and reuse it for
  // every payload. Reset alongside the session-create effect.
  const gameSessionIdRef = useRef<string>("");
  const lastAugmentResponseRef = useRef<AugmentFitResult | null>(null);

  liveGameStateRef.current = liveGameState;
  if (liveGameState.activePlayer) {
    lastInGameStateRef.current = liveGameState;
  }
  gameDataRef.current = gameData;
  // Only persist non-null mode; the game-end effect needs the last
  // in-game mode and `mode` flips to null when activePlayer becomes
  // null (the post-game render no longer satisfies detectMode's
  // "connected" precondition).
  if (mode) {
    modeRef.current = mode;
  }
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
    // TODO(#108 phase 7): champ-select session creation + transitionTo wiring
    // is intentionally deferred until #70 (champ-select coaching) and #84
    // (post-game follow-up) land. Today no feature declares supportedPhases
    // for "champ-select" or "post-game", so wiring those transitions here
    // would just log no-op events. The infrastructure (phase getter,
    // transitionTo, supportedPhases enforcement) is in place — when those
    // tickets land, they should:
    //   - Move session creation to first non-null `liveGameState.champSelect`
    //     (phase: "champ-select")
    //   - Call `session.transitionTo("in-game", buildBaseContext(...))` when
    //     `activePlayer` first appears (replacing the current "create on
    //     activePlayer" path)
    //   - Call `session.transitionTo("post-game", ...)` in the
    //     game-just-ended effect below, before the session is reset
    sessionRef.current = createMatchSession(baseContext, apiKey, {
      personality: getPersonality,
      phase: "in-game",
    });
    gamePlanFeatureRef.current = createGamePlanFeature(gameDataRef.current);
    setChosenAugments([]);
    gamePlanFiredRef.current = false;
    gamePlanRevRef.current = 0;
    gameSessionIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

    // Fire post-game takeaway iff there was any coach activity. Skip when
    // the game produced no decisions — there's nothing to reflect on, and
    // we don't want to pay for an LLM call to produce empty prose.
    const totalDecisions = feed.length;
    const itemRecCount = feed.filter(
      (e): e is CoachingExchangeEntry =>
        e.type === "coaching-exchange" && e.source === "item-rec"
    ).length;
    const trueVoiceCount = voiceEntries.filter(
      (e) => e.source === "voice"
    ).length;
    const hasActivity = totalDecisions > 0 || gamePlanRevRef.current > 0;
    const lastInGameMode = modeRef.current;
    proactiveLog.info(
      `Takeaway gate — apiKey=${!!apiKey} mode=${!!lastInGameMode} activePlayer=${!!lastState.activePlayer} totalDecisions=${totalDecisions} planRevs=${gamePlanRevRef.current} voiceTurns=${trueVoiceCount} itemRecs=${itemRecCount}`
    );
    if (apiKey && lastInGameMode && lastState.activePlayer && hasActivity) {
      const championName =
        activeInfo?.championName ??
        lastState.activePlayer?.championName ??
        "Unknown";
      const finalItems = activeInfo?.items.map((i) => i.name) ?? [];
      const finalPlan = gamePlan$.getValue();
      const recommendedBuild = finalPlan?.buildPath.map((b) => b.name) ?? [];
      const matchedItemCount = recommendedBuild.filter((r) =>
        finalItems.includes(r)
      ).length;
      // Only true voice exchanges go into the LLM context — proactive
      // item-rec firings are auto-prompted ("I just died...") and shouldn't
      // be retold to the model as if the player had asked them.
      const allVoiceExchanges = voiceEntries
        .filter((e) => e.source === "voice")
        .map((e) => ({ question: e.question, answer: e.answer }));

      const takeawayInput: PostGameTakeawayInput = {
        champion: championName,
        gameMode: lastState.gameMode || eog?.gameMode || "",
        isWin: eog?.isWin ?? false,
        duration: eog?.gameLength ?? lastState.gameTime,
        kills: activeInfo?.kills ?? 0,
        deaths: activeInfo?.deaths ?? 0,
        assists: activeInfo?.assists ?? 0,
        finalGold: lastState.activePlayer.currentGold ?? null,
        finalItems,
        recommendedBuild,
        augmentsPicked: chosenAugmentsRef.current,
        voiceExchanges: allVoiceExchanges,
        planRevisionCount: gamePlanRevRef.current,
      };

      const sessionGameId = gameSessionIdRef.current;
      const sessionGameMode = lastState.gameMode;
      proactiveLog.info(
        `Takeaway will send: sessionGameId=${sessionGameId || "EMPTY"} sessionGameMode=${sessionGameMode || "EMPTY"} championName=${championName}`
      );

      // Throwaway post-game session — the in-game session has been cleared
      // (or is about to be) by the session-create effect's null branch.
      const postGameState: GameState = {
        status: "connected",
        activePlayer: lastState.activePlayer,
        players: lastState.players,
        gameMode: lastState.gameMode,
        gameTime: lastState.gameTime,
      };
      const postGameContext = buildBaseContext({
        mode: lastInGameMode,
        gameData: gameDataRef.current,
        gameState: postGameState,
      });
      const postGameSession = createMatchSession(postGameContext, apiKey, {
        personality: getPersonality,
        phase: "post-game",
      });

      proactiveLog.info("Generating post-game takeaway");
      postGameSession
        .ask(postGameTakeawayFeature, takeawayInput)
        .then(({ value: result, retried }) => {
          window.electronAPI?.sendCoachingResponse({
            answer: "",
            recommendations: [],
            buildPath: null,
            retried,
            source: "takeaway",
            narrative: result.narrative,
            champion: championName,
            isWin: takeawayInput.isWin,
            duration: takeawayInput.duration,
            kills: takeawayInput.kills,
            deaths: takeawayInput.deaths,
            assists: takeawayInput.assists,
            finalGold: takeawayInput.finalGold,
            finalItems,
            recommendedBuild,
            matchedItemCount,
            gameId: sessionGameId,
            gameMode: sessionGameMode,
            sentAt: Date.now(),
          });
          proactiveLog.info("Post-game takeaway captured");
        })
        .catch((err) => {
          proactiveLog.error(`Post-game takeaway failed: ${err}`);
        });
    }
  }, [liveGameState.activePlayer, apiKey, mode]);

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

      // #109: the prompt forbids more than one Boots-tagged item, but the
      // schema enum can't express uniqueness. Log when the LLM slips so
      // regressions are visible in playtest logs.
      const duplicateBoots = findDuplicateBoots(
        buildPath,
        gameDataRef.current.items
      );
      if (duplicateBoots.length > 0) {
        proactiveLog.warn(
          `Game plan build path contains ${duplicateBoots.length} boots items: ${duplicateBoots
            .map((b) => b.name)
            .join(", ")}`
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
      gamePlanRevRef.current += 1;
      const rev = gamePlanRevRef.current;
      proactiveLog.info(`Sending game plan response to overlay (rev=${rev})`);
      window.electronAPI?.sendCoachingResponse({
        answer: response.answer,
        recommendations: [],
        buildPath,
        source: "plan",
        rev,
        gameId: gameSessionIdRef.current,
        gameMode: liveGameStateRef.current.gameMode,
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
          "", // augment-fit has no prose answer; UI renders ratings only
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
          question,
          gameId: gameSessionIdRef.current,
          gameMode: liveGameStateRef.current.gameMode,
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
        // Route item-purchase questions to itemRecFeature so its prompt's
        // destination+component format rule applies (#113). Strategic /
        // positional / mechanical questions stay on voiceQueryFeature.
        const useItemRec = isItemRecQuestion(trimmedQuestion);
        proactiveLog.info(
          `Voice question routing: "${trimmedQuestion}" → ${useItemRec ? "itemRec" : "voiceQuery"}`
        );
        const askResult = useItemRec
          ? await sessionRef.current.ask(
              itemRecFeature,
              { snapshot, question },
              { signal: options?.signal }
            )
          : await sessionRef.current.ask(
              voiceQueryFeature,
              { snapshot, question },
              { signal: options?.signal }
            );
        const { value: response, retried } = askResult;

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
          question,
          gameId: gameSessionIdRef.current,
          gameMode: liveGameStateRef.current.gameMode,
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

  // Proactive engine — routes decision-point triggers to feature calls.
  // Triggers: augment-offer (Phase 1), shop-moment + gold-available (Phase 2).
  // Passive-observation triggers land in Phase 3.
  //
  // Global min-gap of 30s aggressively rate-limits cross-trigger LLM calls so
  // proactive coaching never feels like a chat firehose. Augment-offer
  // bypasses the gap (game-rate-limited; can't miss anvil moments). Item
  // triggers respect it.
  useEffect(() => {
    if (!mode) return;

    const augmentTrigger = createAugmentOfferTrigger({
      augmentOffer$,
      augmentPicked$,
      handle: async (names, signal) => {
        await submitAugmentQuery([...names], { signal });
      },
    });

    const itemRecHandle = async (
      state: LiveGameState,
      signal: AbortSignal,
      trigger: ItemRecTrigger
    ) => {
      if (!sessionRef.current || !apiKey) return;
      const question =
        trigger === "shop-moment"
          ? "I just died. What are my best 2-3 purchase options right now?"
          : "I just reached enough gold for my next main item. What should I prioritize next time I shop?";
      try {
        const snapshot = takeGameSnapshot(
          state,
          enemyStatsRef.current,
          gameDataRef.current,
          chosenAugmentsRef.current
        );
        proactiveLog.info(`Item-rec ${trigger} fired`);
        const { value: response, retried } = await sessionRef.current.ask(
          itemRecFeature,
          { snapshot, question, trigger },
          { signal }
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
          "item-rec",
          retried
        );
        const sentAt = Date.now();
        window.electronAPI?.sendCoachingResponse({
          answer: response.answer,
          recommendations: response.recommendations,
          buildPath: null,
          retried,
          // Proactive item-rec — auto-fired on shop-moment / gold-available.
          // Distinguished from voice-query (source: "reactive") so the
          // post-game surface doesn't fold it into the conversation block
          // as if the player had asked.
          source: "item-rec",
          question,
          gameId: gameSessionIdRef.current,
          gameMode: liveGameStateRef.current.gameMode,
          sentAt,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          proactiveLog.debug(`Item-rec ${trigger} cancelled`);
        } else {
          const msg = err instanceof Error ? err.message : "Request failed";
          proactiveLog.error(`Item-rec ${trigger} error: ${msg}`);
        }
      }
    };

    const shopMomentTrigger = createShopMomentTrigger(
      { liveGameState$ },
      (state, signal) => itemRecHandle(state, signal, "shop-moment")
    );

    const goldAvailableTrigger = createGoldAvailableTrigger(
      {
        liveGameState$,
        gamePlan$,
        // Item catalog is keyed by ID; iterate to find by name. Items are
        // ~200 entries; linear scan is fine for the rare trigger fire path.
        getItemCost: (name) => {
          for (const item of gameDataRef.current.items.values()) {
            if (item.name === name) return item.gold.total;
          }
          return null;
        },
      },
      (state, signal) => itemRecHandle(state, signal, "gold-available")
    );

    const engine = new ProactiveEngine(
      mode,
      [augmentTrigger, shopMomentTrigger, goldAvailableTrigger],
      { globalMinGapMs: 30_000 }
    );
    return () => engine.dispose();
  }, [mode, submitAugmentQuery, apiKey]);

  // Player-side augment pick tracking — chosen augments + manual input feed.
  // Separate from the trigger's cancel$ because these are app state updates,
  // not cancellation semantics.
  useEffect(() => {
    const sub = augmentPicked$.subscribe((name) => {
      // Clear pinned ratings — next offer is a fresh selection round
      lastAugmentResponseRef.current = null;
      if (chosenAugmentsRef.current.includes(name)) return;
      const next = [...chosenAugmentsRef.current, name];
      chosenAugmentsRef.current = next;
      setChosenAugments(next);
      const augmentData = gameDataRef.current.augments.get(name.toLowerCase());
      if (augmentData) {
        manualInput$.next({ type: "augment", augment: augmentData });
      }
      proactiveLog.info(`Augment added to build: ${name}`);
    });
    return () => sub.unsubscribe();
  }, []);

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
