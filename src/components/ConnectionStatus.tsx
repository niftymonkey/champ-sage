import { useRef } from "react";
import type { GameLifecycleEvent, GameflowPhase } from "../lib/reactive/types";
import { getLogger } from "../lib/logger";
import styles from "./ConnectionStatus.module.css";

const statusLog = getLogger("ui");

interface ConnectionStatusProps {
  lifecycle: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
}

type Variant =
  | "waiting"
  | "connected"
  | "lobby"
  | "active"
  | "postgame"
  | "error";

interface StatusInfo {
  variant: Variant;
  label: string;
  detail: string;
}

/**
 * Derive the display status from the lifecycle event AND the last known phase.
 *
 * The gameflow phase is the source of truth. Lobby/session/matchmaking events
 * are only used to enhance display when they're consistent with the current
 * phase. This prevents stale lobby events from overriding phases like "None"
 * (when leaving lobby) or post-game phases.
 */
function getStatus(
  lifecycle: GameLifecycleEvent,
  lastPhase: GameflowPhase | null
): StatusInfo {
  if (lifecycle.type === "connection") {
    if (lifecycle.connected) {
      return {
        variant: "connected",
        label: "League Client",
        detail: "Connected",
      };
    }
    return {
      variant: "waiting",
      label: "Waiting for League Client",
      detail: "Launch League of Legends to get started",
    };
  }

  // For non-phase events (lobby, matchmaking, session), only show them
  // if the current phase is consistent
  if (lifecycle.type === "lobby" && lastPhase === "Lobby") {
    return { variant: "lobby", label: "Lobby", detail: "Selecting game mode" };
  }

  if (lifecycle.type === "matchmaking" && lastPhase === "Matchmaking") {
    return {
      variant: "active",
      label: "Matchmaking",
      detail: "Searching for a game",
    };
  }

  // Session events fire during champ select — only show "In Queue"
  // if we're actually in matchmaking, not champ select
  if (lifecycle.type === "session" && lastPhase === "Matchmaking") {
    return {
      variant: "active",
      label: "In Queue",
      detail: "Waiting for match",
    };
  }

  if (lifecycle.type === "phase") {
    switch (lifecycle.phase) {
      case "None":
        return {
          variant: "connected",
          label: "League Client",
          detail: "Connected",
        };
      case "Lobby":
        return {
          variant: "lobby",
          label: "Lobby",
          detail: "Selecting game mode",
        };
      case "Matchmaking":
        return {
          variant: "active",
          label: "Matchmaking",
          detail: "Searching for a game",
        };
      case "ReadyCheck":
        return {
          variant: "active",
          label: "Match Found",
          detail: "Accept the match",
        };
      case "ChampSelect":
        return {
          variant: "active",
          label: "Champion Select",
          detail: "Pick your champion",
        };
      case "GameStart":
      case "InProgress":
        return {
          variant: "active",
          label: "Loading",
          detail: "Loading into game",
        };
      case "PreEndOfGame":
      case "EndOfGame":
      case "WaitingForStats":
        return {
          variant: "postgame",
          label: "Post-Game",
          detail: "Game ended",
        };
      case "TerminatedInError":
        return {
          variant: "error",
          label: "Error",
          detail: "Game terminated unexpectedly",
        };
      default:
        return {
          variant: "connected",
          label: "League Client",
          detail: lifecycle.phase,
        };
    }
  }

  // Non-phase event that doesn't match the current phase — fall back to phase
  if (lastPhase) {
    return getStatus({ type: "phase", phase: lastPhase }, lastPhase);
  }

  return {
    variant: "waiting",
    label: "Waiting for League Client",
    detail: "Launch League of Legends to get started",
  };
}

function describeEvent(event: GameLifecycleEvent): string {
  if (event.type === "connection") return `connection(${event.connected})`;
  if (event.type === "phase") return `phase(${event.phase})`;
  return event.type;
}

export function ConnectionStatus({
  lifecycle,
  lastPhase,
}: ConnectionStatusProps) {
  const prevStatusRef = useRef<string | null>(null);

  const status = getStatus(lifecycle, lastPhase);

  const statusKey = `${status.variant}:${status.label}`;
  if (statusKey !== prevStatusRef.current) {
    statusLog.info(
      `Status: ${status.label} [${status.variant}] (from ${describeEvent(lifecycle)}, phase=${lastPhase ?? "none"})`
    );
    prevStatusRef.current = statusKey;
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.runeCircle} ${styles[status.variant]}`}>
        <div className={styles.outerRing}>
          <span className={`${styles.cardinal} ${styles.n}`} />
          <span className={`${styles.cardinal} ${styles.s}`} />
          <span className={`${styles.cardinal} ${styles.e}`} />
          <span className={`${styles.cardinal} ${styles.w}`} />
        </div>
        <div className={styles.innerRing} />
        <div className={styles.gem} />
      </div>
      <div className={`${styles.label} ${styles[status.variant]}`}>
        {status.label}
      </div>
      <div className={styles.detail}>{status.detail}</div>
    </div>
  );
}
