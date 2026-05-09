import { useEffect, useState } from "react";
import { playerBuildDirection$ } from "../lib/reactive/build-direction-store";
import type { BuildDirection } from "../lib/build-direction/taxonomy";

export function usePlayerBuildDirection(): BuildDirection | null {
  const [value, setValue] = useState(playerBuildDirection$.getValue());
  useEffect(() => {
    const sub = playerBuildDirection$.subscribe(setValue);
    return () => sub.unsubscribe();
  }, []);
  return value;
}
