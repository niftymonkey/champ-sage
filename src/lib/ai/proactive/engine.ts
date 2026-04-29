import { NEVER, Subscription, timer } from "rxjs";
import { switchMap, takeUntil } from "rxjs/operators";
import type { GameMode } from "../../mode/types";
import { getLogger } from "../../logger";
import type { DecisionPointTrigger } from "./types";

const log = getLogger("coaching:proactive");

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

    log.info(
      `Engine starting: ${triggers.length} trigger(s), globalMinGap=${this.globalMinGapMs}ms, mode.decisionTypes=[${mode.decisionTypes.join(", ")}]`
    );

    for (const trigger of triggers) {
      if (
        trigger.decisionType !== "passive-observation" &&
        !mode.decisionTypes.includes(trigger.decisionType)
      ) {
        log.info(
          `Trigger ${trigger.id} skipped — decisionType "${trigger.decisionType}" not in mode`
        );
        continue;
      }
      log.info(
        `Trigger ${trigger.id} registered (decisionType=${trigger.decisionType}, debounce=${trigger.debounceMs}ms, cooldown=${trigger.cooldownMs}ms, respectGap=${trigger.respectGlobalGap !== false})`
      );
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
          const remaining = this.globalMinGapMs - (t - this.lastGlobalFireAt);
          log.info(
            `Trigger ${trigger.id} SUPPRESSED — global gap (${remaining}ms remaining)`
          );
          return;
        }
        const last =
          this.lastFiredAt.get(trigger.id) ?? Number.NEGATIVE_INFINITY;
        if (t - last < trigger.cooldownMs) {
          const remaining = trigger.cooldownMs - (t - last);
          log.info(
            `Trigger ${trigger.id} SUPPRESSED — per-trigger cooldown (${remaining}ms remaining)`
          );
          return;
        }

        // Supersede: abort any prior in-flight call for this trigger
        if (this.inFlight.has(trigger.id)) {
          log.info(`Trigger ${trigger.id} prior in-flight aborted (supersede)`);
        }
        this.abortTrigger(trigger.id);

        const controller = new AbortController();
        this.inFlight.set(trigger.id, controller);
        this.lastFiredAt.set(trigger.id, t);
        if (respectGap) this.lastGlobalFireAt = t;

        log.info(`Trigger ${trigger.id} FIRED`);

        void trigger
          .handle(ctx, controller.signal)
          .catch(() => {
            // Errors/aborts are the handler's to own
          })
          .finally(() => {
            // Clear in-flight entry on completion (resolve OR reject), but
            // only if a newer fire hasn't already replaced this controller.
            // Without this cleanup, the entry leaks and subsequent fires log
            // misleading "prior in-flight aborted" messages even when the
            // prior call had long since completed cleanly.
            if (this.inFlight.get(trigger.id) === controller) {
              this.inFlight.delete(trigger.id);
            }
          });
      })
    );

    if (trigger.cancel$) {
      this.subs.add(
        trigger.cancel$.subscribe(() => {
          if (this.disposed) return;
          if (this.inFlight.has(trigger.id)) {
            log.info(`Trigger ${trigger.id} in-flight aborted (cancel$)`);
          }
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

  /** Visible-to-tests count of currently running handle() calls. */
  get inFlightSize(): number {
    return this.inFlight.size;
  }

  dispose(): void {
    if (this.disposed) return;
    const inFlightCount = this.inFlight.size;
    this.disposed = true;
    for (const ctrl of this.inFlight.values()) ctrl.abort();
    this.inFlight.clear();
    this.subs.unsubscribe();
    log.info(`Engine disposed (${inFlightCount} in-flight aborted)`);
  }
}
