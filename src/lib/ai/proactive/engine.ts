import { NEVER, Subscription, timer } from "rxjs";
import { switchMap, takeUntil } from "rxjs/operators";
import type { GameMode } from "../../mode/types";
import type { DecisionPointTrigger } from "./types";

export interface ProactiveEngineOptions {
  /** Minimum gap in ms between any two proactive fires. Default 0. */
  globalMinGapMs?: number;
  /** Clock source, injectable for tests. Default `() => Date.now()`. */
  now?: () => number;
}

/**
 * Orchestrates {@link DecisionPointTrigger}s for a given {@link GameMode}.
 *
 * Filters triggers by `mode.decisionTypes` (passive-observation always on),
 * debounces each source, enforces per-trigger cooldown and a configurable
 * global min-gap, and aborts in-flight `handle()` calls on supersede or
 * `cancel$` emit.
 */
export class ProactiveEngine {
  private subs = new Subscription();
  private inFlight = new Map<string, AbortController>();
  private lastFiredAt = new Map<string, number>();
  private lastGlobalFireAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly globalMinGapMs: number;
  private disposed = false;

  constructor(
    mode: Pick<GameMode, "decisionTypes">,
    triggers: readonly DecisionPointTrigger[],
    options: ProactiveEngineOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.globalMinGapMs = options.globalMinGapMs ?? 0;

    for (const trigger of triggers) {
      if (
        trigger.decisionType !== "passive-observation" &&
        !mode.decisionTypes.includes(trigger.decisionType)
      ) {
        continue;
      }
      this.register(trigger);
    }
  }

  private register<T>(trigger: DecisionPointTrigger<T>): void {
    const cancelOrNever = trigger.cancel$ ?? NEVER;

    // switchMap + timer lets cancel$ abort a PENDING debounce (via takeUntil)
    // and a new source emission restart the debounce window.
    const debounced$ = trigger.source$.pipe(
      switchMap((ctx) =>
        timer(trigger.debounceMs).pipe(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          takeUntil(cancelOrNever),
          switchMap(() => Promise.resolve(ctx))
        )
      )
    );

    this.subs.add(
      debounced$.subscribe((ctx) => {
        if (this.disposed) return;
        const t = this.now();
        const respectGap = trigger.respectGlobalGap !== false;

        if (respectGap && t - this.lastGlobalFireAt < this.globalMinGapMs) {
          return;
        }
        const last =
          this.lastFiredAt.get(trigger.id) ?? Number.NEGATIVE_INFINITY;
        if (t - last < trigger.cooldownMs) {
          return;
        }

        // Supersede: abort any prior in-flight call for this trigger
        this.abortTrigger(trigger.id);

        const controller = new AbortController();
        this.inFlight.set(trigger.id, controller);
        this.lastFiredAt.set(trigger.id, t);
        if (respectGap) this.lastGlobalFireAt = t;

        void trigger.handle(ctx, controller.signal).catch(() => {
          // Errors/aborts are the handler's to own
        });
      })
    );

    if (trigger.cancel$) {
      this.subs.add(
        trigger.cancel$.subscribe(() => {
          if (this.disposed) return;
          this.abortTrigger(trigger.id);
        })
      );
    }
  }

  private abortTrigger(id: string): void {
    const ctrl = this.inFlight.get(id);
    if (ctrl) {
      ctrl.abort();
      this.inFlight.delete(id);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const ctrl of this.inFlight.values()) ctrl.abort();
    this.inFlight.clear();
    this.subs.unsubscribe();
  }
}
