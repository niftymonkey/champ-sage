import { Observable, Subscription } from "rxjs";

/**
 * Inputs the empty-state visibility stream needs. All void-event streams
 * are passed in so this module stays headless and the wiring lives at the
 * call site.
 */
export interface EmptyVisibilityInputs {
  /** Fires once when a new game's overlay session begins. */
  gameStarted$: Observable<void>;
  /** Fires when the player presses (or releases - either edge) the
   *  push-to-talk hotkey. The first press in a game session disables
   *  any further auto-show for that session. */
  pttPressed$: Observable<void>;
  /** Activity signals - any of these silence the empty card and reset the
   *  >5min silence timer. */
  voiceAnswer$: Observable<void>;
  planRevision$: Observable<void>;
  threatSpike$: Observable<void>;
  /**
   * Lifetime "has the player ever successfully used voice Q&A" flag. When
   * this returns true, the >5min silence re-show is disabled - the player
   * learned the gesture, no need to teach it again.
   */
  hasLearnedPtt: () => boolean;
}

export interface EmptyVisibilityOptions {
  /** Initial show duration after game start. Default 30s. */
  showOnStartMs?: number;
  /** Silence threshold for the auto-reshow. Default 5 minutes. */
  silenceMs?: number;
}

const DEFAULT_SHOW_ON_START_MS = 30_000;
const DEFAULT_SILENCE_MS = 5 * 60_000;

/**
 * Build the emptyVisible$ observable.
 *
 * Behavior, per v16 spec for the empty/prompt state:
 *   - Shows for the first 30s of a new game session.
 *   - Shows again after 5+ minutes of overlay silence, but only if the
 *     player has not yet learned the push-to-talk gesture.
 *   - Hides immediately on PTT press; the first press in a session
 *     disables further auto-show for that session.
 *   - Any coach activity (voice answer, plan revision, threat spike) hides
 *     the empty card and resets the silence timer.
 */
export function createEmptyVisibility(
  inputs: EmptyVisibilityInputs,
  options: EmptyVisibilityOptions = {}
): Observable<boolean> {
  const showOnStartMs = options.showOnStartMs ?? DEFAULT_SHOW_ON_START_MS;
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;

  return new Observable<boolean>((subscriber) => {
    let visible = false;
    let sessionHasUsedPtt = false;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const setVisible = (next: boolean): void => {
      if (visible === next) return;
      visible = next;
      subscriber.next(next);
    };

    const cancelShowTimer = (): void => {
      if (showTimer !== null) {
        clearTimeout(showTimer);
        showTimer = null;
      }
    };

    const cancelSilenceTimer = (): void => {
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };

    const armSilenceTimer = (): void => {
      cancelSilenceTimer();
      if (sessionHasUsedPtt) return;
      if (inputs.hasLearnedPtt()) return;
      silenceTimer = setTimeout(() => {
        if (sessionHasUsedPtt || inputs.hasLearnedPtt()) return;
        setVisible(true);
      }, silenceMs);
    };

    // Initial emission so subscribers see the starting state.
    subscriber.next(visible);

    const subs = new Subscription();

    subs.add(
      inputs.gameStarted$.subscribe(() => {
        sessionHasUsedPtt = false;
        cancelShowTimer();
        // First-30s teach period - skip if the player has already learned.
        if (!inputs.hasLearnedPtt()) {
          setVisible(true);
          showTimer = setTimeout(() => {
            setVisible(false);
            armSilenceTimer();
          }, showOnStartMs);
        } else {
          setVisible(false);
          armSilenceTimer();
        }
      })
    );

    subs.add(
      inputs.pttPressed$.subscribe(() => {
        sessionHasUsedPtt = true;
        cancelShowTimer();
        cancelSilenceTimer();
        setVisible(false);
      })
    );

    const onActivity = (): void => {
      cancelShowTimer();
      setVisible(false);
      armSilenceTimer();
    };
    subs.add(inputs.voiceAnswer$.subscribe(onActivity));
    subs.add(inputs.planRevision$.subscribe(onActivity));
    subs.add(inputs.threatSpike$.subscribe(onActivity));

    return () => {
      cancelShowTimer();
      cancelSilenceTimer();
      subs.unsubscribe();
    };
  });
}
