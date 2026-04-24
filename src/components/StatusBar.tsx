import { useLiveGameState } from "../hooks/useLiveGameState";
import { useGameLifecycle } from "../hooks/useGameLifecycle";
import { PersonalityToggle } from "./PersonalityToggle";
import { ClearOverlaysButton } from "./ClearOverlaysButton";
import styles from "./StatusBar.module.css";

interface StatusBarProps {
  isRecording: boolean;
}

export function StatusBar({ isRecording }: StatusBarProps) {
  const liveGame = useLiveGameState();
  const { event: lifecycle } = useGameLifecycle();

  const isConnected =
    lifecycle.type === "connection" ? lifecycle.connected : true;
  const active = liveGame.activePlayer;
  const activePlayerInfo = liveGame.players.find((p) => p.isActivePlayer);

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <div
          className={`${styles.dot} ${isConnected ? styles.dotConnected : styles.dotDisconnected}`}
          title={
            isConnected
              ? "Connected to League client"
              : "Not connected to League client"
          }
        />
        {active && activePlayerInfo ? (
          <InGameStatus
            gameMode={liveGame.gameMode}
            gameTime={liveGame.gameTime}
            championName={active.championName}
            level={active.level}
            kills={activePlayerInfo.kills}
            deaths={activePlayerInfo.deaths}
            assists={activePlayerInfo.assists}
            gold={active.currentGold}
          />
        ) : (
          <span className={styles.appName}>Champ Sage</span>
        )}
      </div>
      <div className={styles.right}>
        <PersonalityToggle />
        <span className={styles.sep}>|</span>
        <ClearOverlaysButton />
        <span className={styles.sep}>|</span>
        <VoiceIndicator isRecording={isRecording} />
      </div>
    </div>
  );
}

interface InGameStatusProps {
  gameMode: string;
  gameTime: number;
  championName: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
}

function InGameStatus({
  gameMode,
  gameTime,
  championName,
  level,
  kills,
  deaths,
  assists,
  gold,
}: InGameStatusProps) {
  return (
    <>
      <span className={styles.mode}>{gameMode}</span>
      <span className={styles.gameTime}>{formatGameTimeClock(gameTime)}</span>
      <span className={styles.sep}>|</span>
      <span className={styles.text}>
        {championName} Lv{level}
      </span>
      <span className={styles.sep}>|</span>
      <KdaDisplay kills={kills} deaths={deaths} assists={assists} />
      <span className={styles.sep}>|</span>
      <span className={styles.gold} title="Current gold">
        {Math.floor(gold).toLocaleString()}g
      </span>
    </>
  );
}

interface KdaDisplayProps {
  kills: number;
  deaths: number;
  assists: number;
}

function KdaDisplay({ kills, deaths, assists }: KdaDisplayProps) {
  return (
    <span className={styles.kda} title="Kills / Deaths / Assists">
      <span className={styles.kdaKills}>{kills}</span>
      <span className={styles.kdaSep}>•</span>
      <span className={styles.kdaDeaths}>{deaths}</span>
      <span className={styles.kdaSep}>•</span>
      <span className={styles.kdaAssists}>{assists}</span>
    </span>
  );
}

interface VoiceIndicatorProps {
  isRecording: boolean;
}

function VoiceIndicator({ isRecording }: VoiceIndicatorProps) {
  return (
    <span
      className={`${styles.voice} ${isRecording ? styles.voiceRecording : ""}`}
      title="Hold to ask your coach a question"
    >
      <span
        className={`${styles.voiceRing} ${isRecording ? styles.voiceRingRecording : ""}`}
      />
      Num-
    </span>
  );
}

function formatGameTimeClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
