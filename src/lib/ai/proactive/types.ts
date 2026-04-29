import type { Observable } from "rxjs";
import type { DecisionType } from "../../mode/types";

/**
 * A trigger's decisionType is either a mode-gated {@link DecisionType} or the
 * always-on "passive-observation" kind. Passive triggers fire regardless of
 * mode; mode-gated triggers register only when `mode.decisionTypes` includes
 * their kind.
 */
export type TriggerKind = DecisionType | "passive-observation";

/**
 * Declarative registration of a proactive-coaching firing moment.
 *
 * Triggers are pure data + a handler. The {@link ProactiveEngine} owns
 * scheduling (debounce, cooldown, global gap) and cancellation (abort on
 * supersede or `cancel$` emit).
 */
export interface DecisionPointTrigger<TCtx = unknown> {
  /** Stable identifier for logging/cooldown bookkeeping. */
  id: string;
  /** Gate for mode registration — see {@link TriggerKind}. */
  decisionType: TriggerKind;
  /** When to fire. Each emission is a candidate invocation. */
  source$: Observable<TCtx>;
  /**
   * Optional cancellation stream. Each emission aborts the in-flight
   * `handle()` call for this trigger (if any). Does NOT produce a new fire.
   * Used e.g. for augment picks: offer$ fires → handle() runs → picked$ emits → abort.
   */
  cancel$?: Observable<unknown>;
  /** Merge bursts on `source$` within this window before the cooldown check. */
  debounceMs: number;
  /** Minimum gap between two consecutive fires of THIS trigger. */
  cooldownMs: number;
  /**
   * Whether the engine's `globalMinGapMs` applies to this trigger. Default
   * `true`. Set `false` for triggers whose source is already rate-limited by
   * the game (e.g. augment offers arrive once per selection round).
   */
  respectGlobalGap?: boolean;
  /** The actual coaching call. Must thread `signal` through to abortable I/O. */
  handle(ctx: TCtx, signal: AbortSignal): Promise<void>;
}
