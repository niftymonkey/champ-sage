import { useSyncExternalStore } from "react";
import type { BehaviorSubject } from "rxjs";

/**
 * Subscribe a React component to a `BehaviorSubject` and return its
 * current value. Built on `useSyncExternalStore` so the subscription is
 * tearing-safe under concurrent rendering features (Suspense transitions,
 * `useDeferredValue`, etc.) — different components in the same render
 * always observe the same snapshot.
 *
 * Idiomatic replacement for the `useState(getValue()) + useEffect(subscribe)`
 * pattern that appears across this codebase. Behavior is otherwise
 * identical: `subject.getValue()` on first render, re-render on `next()`,
 * unsubscribe on unmount.
 */
export function useBehaviorSubject<T>(subject: BehaviorSubject<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => {
      const sub = subject.subscribe(() => onStoreChange());
      return () => sub.unsubscribe();
    },
    () => subject.getValue(),
    () => subject.getValue(),
  );
}
