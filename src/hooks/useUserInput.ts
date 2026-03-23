import { useCallback } from "react";
import type { UserInputEvent } from "../lib/reactive";
import { manualInput$, playerIntent$ } from "../lib/reactive";

interface UseUserInputResult {
  submit: (event: UserInputEvent) => void;
}

export function useUserInput(): UseUserInputResult {
  const submit = useCallback((event: UserInputEvent) => {
    switch (event.type) {
      case "augment":
        manualInput$.next(event);
        break;
      case "query":
        playerIntent$.next(event);
        break;
    }
  }, []);

  return { submit };
}
