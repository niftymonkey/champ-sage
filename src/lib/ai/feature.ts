import type { FlexibleSchema } from "ai";

/**
 * Lifecycle phase a MatchSession is currently in. Features declare which
 * phases they support via `supportedPhases`.
 */
export type MatchPhase = "champ-select" | "in-game" | "post-game";

/**
 * Engine metadata threaded to `extractResult` alongside the raw LLM output.
 * The `retried` flag reflects whether race-with-retry (#102) served the
 * response from attempt 2.
 */
export interface ExtractMeta {
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

  extractResult(raw: TOutput, meta: ExtractMeta): TOutput;

  /**
   * Prose assistant-turn summary the engine stores in conversation history.
   * When omitted, the engine serializes the full result as JSON.
   */
  summarizeForHistory?(result: TOutput): string;
}
