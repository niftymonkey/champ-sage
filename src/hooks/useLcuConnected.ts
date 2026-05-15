import { lcuCredentials$ } from "../lib/reactive";
import { useBehaviorSubject } from "./useBehaviorSubject";

/**
 * Mirrors the reactive `lcuCredentials$` subject into a boolean. `true`
 * while creds are present; `false` while the engine reports the LCU as
 * offline. Surfaces use this for LCU-aware copy without subscribing inline.
 */
export function useLcuConnected(): boolean {
  return useBehaviorSubject(lcuCredentials$) !== null;
}
