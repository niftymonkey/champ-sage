import { postGameReady$ } from "../lib/reactive/post-game-readiness";
import { useBehaviorSubject } from "./useBehaviorSubject";

/**
 * Mirrors the `postGameReady$` subject. `false` while a game just ended
 * and the surface is waiting for fresh in-memory data; `true` otherwise
 * (steady state OR snapshot refreshed since the end transition).
 */
export function usePostGameReady(): boolean {
  return useBehaviorSubject(postGameReady$);
}
