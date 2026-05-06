/**
 * Legacy personality-store API, rerouted through `src/lib/settings`.
 *
 * The personality preference is now a `defineEnum` setting; this file
 * exists only to keep the historical export shape (`personality$`,
 * `getPersonality`, `setPersonality`, `PERSONALITIES`) working for
 * existing callers (CoachingPipeline, MatchSession, the old
 * PersonalityToggle). New code should import from
 * `src/lib/settings` directly.
 */
import { BehaviorSubject } from "rxjs";
import log from "electron-log/renderer";
import {
  briefPersonality,
  piratePersonality,
  type PersonalityLayer,
} from "./personality";
import { personality, type PersonalityId } from "../settings/registry";
import { getSetting, setSetting, settings$ } from "../settings/runtime";

const PERSONALITY_BY_ID: Record<PersonalityId, PersonalityLayer> = {
  brief: briefPersonality,
  pirate: piratePersonality,
};

export const PERSONALITIES: readonly PersonalityLayer[] = [
  briefPersonality,
  piratePersonality,
];

function currentLayer(): PersonalityLayer {
  return PERSONALITY_BY_ID[getSetting(personality)];
}

/**
 * BehaviorSubject mirror of the personality setting. Subscribes to the
 * generic settings subject and re-emits when the personality value
 * changes — preserves the legacy API for callers that read
 * `personality$.getValue()` or subscribe directly.
 */
export const personality$ = new BehaviorSubject<PersonalityLayer>(
  currentLayer()
);

settings$.subscribe(() => {
  const next = currentLayer();
  if (next !== personality$.getValue()) {
    personality$.next(next);
  }
});

export function getPersonality(): PersonalityLayer {
  return currentLayer();
}

export function setPersonality(p: PersonalityLayer): void {
  const id = (Object.keys(PERSONALITY_BY_ID) as PersonalityId[]).find(
    (k) => PERSONALITY_BY_ID[k] === p
  );
  if (!id) return;
  setSetting(personality, id).catch((err) => {
    // Persistence failure shouldn't be silent — the in-memory value
    // updated, so a discrepancy with disk would surface only on the
    // next launch. Log so it's at least diagnosable.
    log.warn("personality-store: persist failed", err);
  });
}
