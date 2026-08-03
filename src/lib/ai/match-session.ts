/**
 * Match-spanning conversation session.
 *
 * A `MatchSession` lives across the lifecycle of a single match —
 * champ-select → in-game → post-game. The system prompt rebuilds when the
 * phase changes (different base context per phase), but `messages[]` is
 * cumulative: prior-phase asks remain in the LLM's context so a post-game
 * follow-up can reference what was discussed during champ-select or
 * in-game without restating it.
 *
 * Each user message includes a full game state snapshot (not a diff),
 * re-anchoring the LLM to ground truth every turn. The session enforces
 * `feature.supportedPhases` — calling `ask()` with a feature that doesn't
 * support the current phase throws, catching wiring bugs early.
 *
 * Usage:
 *   const session = createMatchSession(systemPrompt, apiKey);
 *   const { value, retried } = await session.ask(someFeature, input);
 */

import type { LanguageModel, ModelMessage } from "ai";
import type { AskResult, CoachingFeature, MatchPhase } from "./feature";
import { runFeatureCall } from "./recommendation-engine";
import { briefPersonality, type PersonalityLayer } from "./personality";
import { summarizeBaseContext } from "./prompt-summary";
import { getLogger } from "../logger";

const sessionLog = getLogger("coaching:session");

export interface CreateMatchSessionOptions {
  /**
   * Optional model override applied to every `session.ask()` call. When
   * omitted, the engine resolves the production model via the apiKey.
   * Match-scoped: one provider for the session's lifetime. The eval harness
   * sets this to swap providers (OpenRouter) without forking call paths.
   */
  readonly model?: LanguageModel;
  /**
   * Personality layer (or getter) whose `suffix()` is appended to the
   * system prompt after the feature task prompt on every `ask()`. Pass a
   * function to pick up mid-session personality switches — the engine
   * resolves fresh on every call. Defaults to `briefPersonality`, which
   * carries the brevity / lead-with-recommendation voice rules that
   * historically lived inside `buildBaseContext`.
   */
  readonly personality?: PersonalityLayer | (() => PersonalityLayer);
  /**
   * Initial lifecycle phase. Defaults to `"in-game"` so callers that don't
   * yet wire phase transitions retain pre-Phase 7 behavior.
   */
  readonly phase?: MatchPhase;
}

export interface MatchSession {
  readonly systemPrompt: string;
  readonly messages: readonly ModelMessage[];
  readonly phase: MatchPhase;

  /**
   * Feature-typed LLM call. Composes the system prompt (session base +
   * feature task + personality suffix), appends the feature's user message
   * to history, invokes the engine, appends the assistant turn, and
   * returns the result wrapped in an `AskResult` envelope. On failure,
   * rolls back the orphaned user turn so history stays clean and the same
   * session is safe to reuse.
   *
   * Throws if the feature doesn't list the session's current phase in
   * `supportedPhases` — catches wiring bugs (e.g. a champ-select feature
   * fired during in-game) at the engine boundary instead of producing a
   * malformed prompt.
   */
  ask<TInput, TOutput>(
    feature: CoachingFeature<TInput, TOutput>,
    input: TInput,
    options?: { signal?: AbortSignal }
  ): Promise<AskResult<TOutput>>;

  /**
   * One-shot corrective follow-up to the immediately preceding `ask` for the
   * same feature (throws otherwise). Sends the accumulated history plus a
   * transient user turn carrying `correction`, composed under the same
   * system prompt `ask` would build. On success the last assistant turn is
   * REPLACED with the corrected result's `summarizeForHistory` and the
   * correction turn is discarded: the corrective exchange must not leak
   * into later voice-query context, and the corrected answer supersedes
   * the first. History therefore ends as [user: original question,
   * assistant: corrected answer]. On failure history is left exactly as it
   * was, so the caller can safely fall back to the original result.
   */
  correctLastAsk<TInput, TOutput>(
    feature: CoachingFeature<TInput, TOutput>,
    input: TInput,
    correction: string,
    options?: { signal?: AbortSignal }
  ): Promise<AskResult<TOutput>>;

  /**
   * Move the session to a new lifecycle phase, swapping in a fresh base
   * context (champ-select / in-game / post-game each have different
   * relevant state). `messages[]` is preserved so the LLM still sees the
   * accumulated conversation; only the system prompt changes.
   */
  transitionTo(phase: MatchPhase, systemPrompt: string): void;

  /**
   * Lower-level history primitives. Used by tests and fixture-replay tooling
   * to seed a session from prior-turn artifacts without mocking the engine.
   */
  addUserMessage(stateSnapshot: string, question: string): void;
  addAssistantMessage(responseText: string): void;
  removeLastUserMessage(): void;
  reset(): void;
}

function formatUserContent(stateSnapshot: string, question: string): string {
  return `[Game State]\n${stateSnapshot}\n\n[Question]\n${question}`;
}

/**
 * Log a base context whenever it is installed (session start or phase change):
 * an always-on `info` line carrying the presence signals, plus the full prompt
 * at `debug` for eyeballing exactly what reached the model. Sharing this keeps
 * a phase transition as verifiable as the initial in-game prompt.
 */
function logBaseContext(headline: string, systemPrompt: string): void {
  sessionLog.info(
    `${headline} baseContext=${systemPrompt.length} chars | ${summarizeBaseContext(systemPrompt).line}`
  );
  // ~12KB; gated to debug. Switch the level via the app's File > Log Level menu
  // BEFORE a match to capture it.
  sessionLog.debug(
    `Base context (${systemPrompt.length} chars):\n${systemPrompt}`
  );
}

export function createMatchSession(
  initialSystemPrompt: string,
  apiKey: string,
  options: CreateMatchSessionOptions = {}
): MatchSession {
  const messages: ModelMessage[] = [];
  const modelOverride = options.model;
  const personalityOption = options.personality;
  const resolvePersonality: () => PersonalityLayer =
    typeof personalityOption === "function"
      ? personalityOption
      : () => personalityOption ?? briefPersonality;

  let systemPrompt = initialSystemPrompt;
  let phase: MatchPhase = options.phase ?? "in-game";
  // Feature id of the last successful `ask`, while its assistant turn is
  // still the tail of history. `correctLastAsk` may only target that turn;
  // any manual history mutation invalidates it.
  let lastAskFeatureId: string | null = null;

  logBaseContext(
    `Session created. phase=${phase} personality=${resolvePersonality().id}`,
    systemPrompt
  );

  return {
    get systemPrompt() {
      return systemPrompt;
    },

    get messages(): readonly ModelMessage[] {
      return messages;
    },

    get phase() {
      return phase;
    },

    transitionTo(nextPhase, nextSystemPrompt) {
      const previousPhase = phase;
      phase = nextPhase;
      systemPrompt = nextSystemPrompt;
      // The prior ask belongs to the phase that just ended. Correcting it now
      // would compose the new phase's system prompt around a feature the new
      // phase may not even support.
      lastAskFeatureId = null;
      logBaseContext(
        `Session phase ${previousPhase} > ${nextPhase}. history preserved (${messages.length} msgs)`,
        systemPrompt
      );
    },

    async ask(feature, input, options) {
      if (!feature.supportedPhases.includes(phase)) {
        throw new Error(
          `Feature "${feature.id}" does not support phase "${phase}" (supports: ${feature.supportedPhases.join(", ")})`
        );
      }

      const personality = resolvePersonality();
      const taskPrompt = feature.buildTaskPrompt(input);
      const personalitySuffix = personality.suffix();
      const suffixSection = personalitySuffix ? `\n\n${personalitySuffix}` : "";
      const system = systemPrompt + taskPrompt + suffixSection;
      const userContent = feature.buildUserMessage(input);

      sessionLog.info(
        `[${feature.id}] ask: phase=${phase} base=${systemPrompt.length} task=${taskPrompt.length} personality=${personality.id}(${personalitySuffix.length}) total=${system.length} chars, history=${messages.length} msgs`
      );

      messages.push({ role: "user", content: userContent });

      try {
        const { value: raw, retried } = await runFeatureCall({
          feature,
          system,
          messages,
          apiKey,
          signal: options?.signal,
          model: modelOverride,
        });

        const result = feature.extractResult(raw);

        messages.push({
          role: "assistant",
          content: feature.summarizeForHistory(result),
        });
        lastAskFeatureId = feature.id;

        return { value: result, retried };
      } catch (err) {
        const last = messages[messages.length - 1];
        if (last?.role === "user" && last.content === userContent) {
          messages.pop();
        }
        throw err;
      }
    },

    async correctLastAsk(feature, input, correction, options) {
      const last = messages[messages.length - 1];
      if (
        !last ||
        last.role !== "assistant" ||
        lastAskFeatureId !== feature.id
      ) {
        throw new Error(
          `correctLastAsk requires the last history message to be the assistant turn of a prior ask for feature "${feature.id}"`
        );
      }

      const personality = resolvePersonality();
      const taskPrompt = feature.buildTaskPrompt(input);
      const personalitySuffix = personality.suffix();
      const suffixSection = personalitySuffix ? `\n\n${personalitySuffix}` : "";
      const system = systemPrompt + taskPrompt + suffixSection;

      sessionLog.info(
        `[${feature.id}] correctLastAsk: correction=${correction.length} chars, history=${messages.length} msgs`
      );

      // The correction turn is transient by design: it rides along for this
      // one call and is never persisted, so the corrective exchange cannot
      // leak into later feature calls' context.
      const transientMessages: ModelMessage[] = [
        ...messages,
        { role: "user", content: correction },
      ];

      // The session is shared by independent handlers, so an ask can land
      // while this call is in flight. Pin the turn being corrected and check
      // it is still the tail before writing, or the replacement would clobber
      // that other ask's answer.
      const targetIndex = messages.length - 1;
      const targetMessage = last;

      const { value: raw, retried } = await runFeatureCall({
        feature,
        system,
        messages: transientMessages,
        apiKey,
        signal: options?.signal,
        model: modelOverride,
      });

      if (
        messages.length - 1 !== targetIndex ||
        messages[targetIndex] !== targetMessage
      ) {
        throw new Error(
          `correctLastAsk for feature "${feature.id}" was abandoned: the session history changed while the corrective call was in flight (a concurrent ask appended turns)`
        );
      }

      const result = feature.extractResult(raw);

      messages[targetIndex] = {
        role: "assistant",
        content: feature.summarizeForHistory(result),
      };

      return { value: result, retried };
    },

    addUserMessage(stateSnapshot: string, question: string): void {
      lastAskFeatureId = null;
      messages.push({
        role: "user",
        content: formatUserContent(stateSnapshot, question),
      });
    },

    addAssistantMessage(responseText: string): void {
      lastAskFeatureId = null;
      messages.push({
        role: "assistant",
        content: responseText,
      });
    },

    removeLastUserMessage(): void {
      if (messages.length === 0) {
        throw new Error("Cannot remove from empty message array");
      }
      const last = messages[messages.length - 1];
      if (last.role !== "user") {
        throw new Error(
          `Last message has role "${last.role}", expected "user"`
        );
      }
      lastAskFeatureId = null;
      messages.pop();
    },

    reset(): void {
      lastAskFeatureId = null;
      messages.length = 0;
    },
  };
}
