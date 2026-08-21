/**
 * The app's single source of truth for "is anything wrong right now, and can
 * the player do something about it?".
 *
 * Before this existed, each subsystem reported its own trouble its own way, and
 * most reported it only to the log. The GEP banner was the one visible channel
 * and it covered one subsystem. Everything else, a boot step that failed, a
 * launcher that could not guard the package, settings that refuse to save, was
 * invisible to the person using the app.
 *
 * The shape is deliberately small: subsystems `set` a status or `clear` it, and
 * the registry emits the whole list on every change. Renderers render the list.
 * No subsystem knows what a banner looks like, and the banner knows nothing
 * about GEP, packages, or the launcher.
 */

/**
 * How bad it is, and therefore how loud the banner should be.
 *
 * `updating` is not a severity so much as a mood: something good is happening
 * and the player may want to act on it. It is reserved for the B track's
 * update-pending banner and carried here so the renderer never needs a second
 * vocabulary.
 */
export type StatusLevel = "ok" | "degraded" | "broken" | "updating";

/** What the banner offers the player. `undefined` means "nothing to do". */
export type StatusAction = "relaunch" | "open-logs" | "retry";

/**
 * The subsystems that can report. Closed on purpose: an open string invites
 * two spellings of the same subsystem and two banners for one problem.
 *
 * `app-update` is a reserved seam for the B track (B-M2/B-M4) and has no
 * producer yet.
 */
export type SubsystemId =
  | "gep"
  | "boot"
  | "settings"
  | "package"
  | "launch"
  | "data"
  | "app-update";

export interface SubsystemStatus {
  id: SubsystemId;
  level: StatusLevel;
  /** One line, addressed to the player, no jargon. */
  message: string;
  /** Optional second line for the detail a player might report back to us. */
  detail?: string;
  action?: StatusAction;
}

export interface StatusRegistry {
  /** Records or replaces the status for one subsystem. */
  set(status: SubsystemStatus): void;
  /** Drops a subsystem's status entirely, as if it had never reported. */
  clear(id: SubsystemId): void;
  /** Every reported status, worst first. */
  list(): SubsystemStatus[];
  /** Calls back with the full list on every change. Returns an unsubscribe. */
  subscribe(listener: (all: SubsystemStatus[]) => void): () => void;
}

/**
 * Display order. `ok` never reaches a list, so it has no rank here; the
 * registry drops it on the way in.
 */
const LEVEL_RANK: Record<Exclude<StatusLevel, "ok">, number> = {
  broken: 0,
  degraded: 1,
  updating: 2,
};

export function createStatusRegistry(): StatusRegistry {
  const byId = new Map<SubsystemId, SubsystemStatus>();
  const listeners = new Set<(all: SubsystemStatus[]) => void>();

  // Copied on the way in and on the way out. Both processes and every banner
  // read this registry, so handing out the stored object would let any consumer
  // silently rewrite the source of truth without going through `set`.
  const copy = (s: SubsystemStatus): SubsystemStatus => ({ ...s });

  const snapshot = (): SubsystemStatus[] =>
    [...byId.values()]
      .map(copy)
      .sort(
        (a, b) =>
          LEVEL_RANK[a.level as Exclude<StatusLevel, "ok">] -
          LEVEL_RANK[b.level as Exclude<StatusLevel, "ok">]
      );

  const emit = (): void => {
    for (const listener of listeners) {
      try {
        // A fresh snapshot each time, so a listener that edits what it received
        // cannot change what the next listener sees.
        listener(snapshot());
      } catch {
        // A broken consumer must not silence the other consumers, and the
        // reporter is usually a subsystem that is already having a bad time.
      }
    }
  };

  return {
    set(next) {
      // `ok` is a subsystem saying it has nothing to show, which is a clear.
      if (next.level === "ok") {
        this.clear(next.id);
        return;
      }
      byId.set(next.id, copy(next));
      emit();
    },
    clear(id) {
      if (!byId.delete(id)) return;
      emit();
    },
    list: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The tokens the launcher can hand the app about its own launch.
 */
export type LaunchStatusToken =
  | "unguarded"
  | "override-timeout"
  | "runtime-repaired"
  | "guard-crash";

const LAUNCH_TOKENS: readonly LaunchStatusToken[] = [
  "unguarded",
  "override-timeout",
  "runtime-repaired",
  "guard-crash",
];

function isLaunchToken(value: string): value is LaunchStatusToken {
  return (LAUNCH_TOKENS as readonly string[]).includes(value);
}

/**
 * Reads `CHAMP_SAGE_LAUNCH_STATUS`, the launcher's only way to tell the app how
 * the launch itself went.
 *
 * The value crosses a PowerShell command line, so an unrecognised token is at
 * least as likely to be a mangled string as a newer launcher, and is dropped
 * rather than shown to the player.
 */
export function parseLaunchStatus(
  value: string | undefined
): LaunchStatusToken[] {
  if (!value) return [];
  const seen = new Set<LaunchStatusToken>();
  for (const raw of value.split(",")) {
    const token = raw.trim();
    if (isLaunchToken(token)) seen.add(token);
  }
  return [...seen];
}

/**
 * Turns launch tokens into the single `launch` banner, or nothing.
 *
 * `runtime-repaired` is deliberately silent: the launcher fixing the runtime is
 * the launcher working, and a banner announcing a completed repair teaches the
 * player that banners are noise. Only tokens that leave the app *worse than it
 * should be* get a line. Nothing in the app can fix any of them, so the action
 * is always the logs.
 */
export function launchStatusToSubsystem(
  tokens: LaunchStatusToken[]
): SubsystemStatus | null {
  const reasons: string[] = [];
  if (tokens.includes("unguarded")) {
    reasons.push("the package guard did not run");
  }
  if (tokens.includes("guard-crash")) {
    reasons.push("the package guard crashed");
  }
  if (tokens.includes("override-timeout")) {
    reasons.push("the package override timed out");
  }
  if (reasons.length === 0) return null;

  return {
    id: "launch",
    level: "degraded",
    message:
      "Champ Sage started without its usual package checks. Augment coaching may be out of date.",
    detail: `On launch, ${reasons.join(" and ")}.`,
    action: "open-logs",
  };
}
