import { playerBuildDirection$ } from "../lib/reactive/build-direction-store";
import type { BuildDirection } from "../lib/build-direction/taxonomy";
import { useBehaviorSubject } from "./useBehaviorSubject";

export function usePlayerBuildDirection(): BuildDirection | null {
  return useBehaviorSubject(playerBuildDirection$);
}
