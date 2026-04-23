/**
 * Runtime-swappable personality selection.
 *
 * The `MatchSession` reads the current personality fresh on every
 * `ask()` call (via the function form of `createMatchSession`'s
 * personality option). That means the player can flip personalities
 * mid-match and the very next coaching response uses the new voice —
 * useful for comparing how `briefPersonality` and `piratePersonality`
 * shape identical state.
 *
 * Persistence: routed through the Electron main process to a JSON file in
 * the user data dir. The renderer's localStorage didn't survive between
 * launches in this setup (writes succeeded mid-session but the storage
 * scope was empty on restart — likely the Vite dev-server origin or the
 * ow-electron renderer session lifecycle). The IPC + file approach avoids
 * that entire class of issue. When #24 lands the full settings UX this
 * store becomes the source of truth the settings picker writes into.
 */
import { BehaviorSubject } from "rxjs";
import {
  briefPersonality,
  piratePersonality,
  type PersonalityLayer,
} from "./personality";

export const PERSONALITIES: readonly PersonalityLayer[] = [
  briefPersonality,
  piratePersonality,
];

const SETTINGS_KEY = "personality.id";

interface SettingsBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function getBridge(): SettingsBridge | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: SettingsBridge })
    .electronAPI;
  return api ?? null;
}

export const personality$ = new BehaviorSubject<PersonalityLayer>(
  briefPersonality
);

// Async load on module init. Personality starts at brief, then promotes to
// the persisted choice once the IPC round-trip completes. The `ask()` path
// re-reads on every call, so the flip applies retroactively to any
// in-flight session without manual reset.
void hydrate();

async function hydrate(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  try {
    const id = await bridge.invoke("settings:get", SETTINGS_KEY);
    if (typeof id !== "string") return;
    const match = PERSONALITIES.find((p) => p.id === id);
    if (match) personality$.next(match);
  } catch {
    // Bridge missing or IPC failed (test environment, broken main process)
    // — keep brief default. The next setPersonality call will retry.
  }
}

export function getPersonality(): PersonalityLayer {
  return personality$.getValue();
}

export function setPersonality(personality: PersonalityLayer): void {
  personality$.next(personality);
  const bridge = getBridge();
  if (!bridge) return;
  void bridge.invoke("settings:set", SETTINGS_KEY, personality.id);
}
