import type { FlexibleSchema } from "ai";

/**
 * Lifecycle phase a MatchSession is currently in. Features declare which
 * phases they support via `supportedPhases`.
 */
export type MatchPhase = "champ-select" | "in-game" | "post-game";

/**
 * Engine-level envelope returned by `session.ask()`. The `retried` flag
 * reflects whether race-with-retry (#102) served the response from attempt
 * 2; it lives here rather than on the feature result body so per-feature
 * schemas don't need a `retried` slot.
 */
export interface AskResult<T> {
  readonly value: T;
  readonly retried: boolean;
}

/**
 * Contract every LLM-driven feature implements. Co-locates the pieces a
 * feature owns (task prompt, user-message shape, output schema, result
 * normalization) without leaking engine concerns (retry, abort, model
 * selection, history management).
 */
export interface CoachingFeature<TInput, TOutput> {
  readonly id: string;
  readonly supportedPhases: readonly MatchPhase[];

  /** Feature-specific task instructions appended after the session's base context. */
  buildTaskPrompt(input: TInput): string;

  /**
   * The user message body the engine pushes onto conversation history. Should
   * include both the state snapshot and the question so the LLM sees ground
   * truth on every turn.
   */
  buildUserMessage(input: TInput): string;

  outputSchema: FlexibleSchema<TOutput>;

  /**
   * Normalize the raw LLM output into the feature's canonical result shape.
   * Use this for post-processing like synthesizing fallback fields; the
   * engine does not pass retry metadata here — that surfaces via the
   * `AskResult` envelope returned by `session.ask()`.
   */
  extractResult(raw: TOutput): TOutput;

  /**
   * Prose assistant-turn summary the engine stores in conversation history.
   * When omitted, the engine serializes the full result as JSON.
   */
  summarizeForHistory?(result: TOutput): string;
}
