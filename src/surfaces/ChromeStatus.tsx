import { useLiveGameState } from "../hooks/useLiveGameState";
import { PUSH_TO_TALK_HOTKEY, formatHotkeyLabel } from "../hooks/useVoiceInput";
import styles from "./ChromeStatus.module.css";

const APP_VERSION = `v${(import.meta.env.VITE_APP_VERSION ?? "0.1.0") as string}`;

interface ChromeStatusProps {
  /** True while the push-to-talk key is held and the mic is capturing. */
  isRecording: boolean;
  /**
   * Whether voice push-to-talk is available at all. False when no STT
   * provider is configured; the hint pill is suppressed in that case so
   * we do not advertise a gesture the user cannot trigger.
   */
  voiceAvailable: boolean;
}

/**
 * Right-region content for the v16 window chrome. Renders the mono status
 * string the design defines. Voice indicator only appears during a live
 * game - voice queries are gated to in-game today; the planned "rejoin a
 * finished session" feature does not exist yet.
 */
export function ChromeStatus({
  isRecording,
  voiceAvailable,
}: ChromeStatusProps) {
  const liveGame = useLiveGameState();
  const inGame = liveGame.activePlayer !== null;
  const hotkeyLabel = formatHotkeyLabel(PUSH_TO_TALK_HOTKEY);

  return (
    <div className={styles.row}>
      {inGame ? (
        <LiveString
          gameTime={liveGame.gameTime}
          gold={liveGame.activePlayer?.currentGold ?? 0}
          itemsBuilt={countOwnedItems(liveGame)}
          itemsMax={6}
        />
      ) : (
        <IdleString />
      )}
      {voiceAvailable && inGame ? (
        <VoiceCluster isRecording={isRecording} hotkeyLabel={hotkeyLabel} />
      ) : null}
    </div>
  );
}

function IdleString() {
  return (
    <span className={styles.string}>
      No live game <Sep /> {APP_VERSION}
    </span>
  );
}

interface LiveStringProps {
  gameTime: number;
  gold: number;
  itemsBuilt: number;
  itemsMax: number;
}

function LiveString({ gameTime, gold, itemsBuilt, itemsMax }: LiveStringProps) {
  return (
    <span className={`${styles.string} ${styles.live}`}>
      <span className={styles.dot} aria-hidden />
      <strong>Live</strong> <Sep /> {formatClock(gameTime)} <Sep />{" "}
      {Math.floor(gold).toLocaleString()}g <Sep /> {itemsBuilt}/{itemsMax}
    </span>
  );
}

interface VoiceClusterProps {
  isRecording: boolean;
  hotkeyLabel: string;
}

/**
 * The push-to-talk indicator. Listening + key pill live as a single visual
 * unit because they are the same idea - "this is how you trigger voice and
 * this is what voice looks like when you do." The "Listening" word only
 * appears while the mic is actually capturing, so the chrome never claims
 * a state that is not happening.
 */
function VoiceCluster({ isRecording, hotkeyLabel }: VoiceClusterProps) {
  return (
    <span
      className={`${styles.voice} ${isRecording ? styles.voiceRecording : ""}`}
      title={
        isRecording
          ? `Listening - release ${hotkeyLabel} to send`
          : `Hold ${hotkeyLabel} to ask`
      }
    >
      {isRecording ? <span className={styles.listening}>Listening</span> : null}
      <span className={styles.hintPill}>{hotkeyLabel}</span>
    </span>
  );
}

function Sep() {
  return <span> · </span>;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function countOwnedItems(
  liveGame: ReturnType<typeof useLiveGameState>
): number {
  const active = liveGame.players.find((p) => p.isActivePlayer);
  if (!active) return 0;
  // Trinkets and wards inflate the count past the 6-item cap; the chrome
  // status is meant to read "X out of 6 build slots filled," so cap.
  return Math.min(active.items.length, 6);
}
