/**
 * Dev simulator panel — inject mock game events into reactive streams
 * to test the coaching UI without a running League game.
 *
 * Toggled via Ctrl+D. Pushes directly to the same streams that the
 * game engine writes to, so CoachingPipeline and all UI components
 * react identically to real vs. simulated data.
 */

import { useState, useRef } from "react";
import type { LoadedGameData } from "../lib/data-ingest";
import type { LiveGameState } from "../lib/reactive/types";
import { liveGameState$ } from "../lib/reactive/streams";
import { augmentOffer$, augmentPicked$ } from "../lib/reactive/gep-bridge";
import { playerIntent$ } from "../lib/reactive/streams";
import {
  createMockGameState,
  createMockEogStats,
  type MockGameOptions,
} from "./mock-state";
import { PRESETS } from "./presets";
import styles from "./SimulatorPanel.module.css";

interface SimulatorPanelProps {
  gameData: LoadedGameData;
}

export function SimulatorPanel({ gameData }: SimulatorPanelProps) {
  const [gameActive, setGameActive] = useState(false);
  const [champion, setChampion] = useState("Ahri");
  const [gameMode, setGameMode] = useState<MockGameOptions["gameMode"]>("KIWI");
  const [level, setLevel] = useState(3);
  const [gold, setGold] = useState(1400);
  const [gameTime, setGameTime] = useState(0);
  const [kills, setKills] = useState(0);
  const [deaths, setDeaths] = useState(0);
  const [assists, setAssists] = useState(0);

  const [augment1, setAugment1] = useState("");
  const [augment2, setAugment2] = useState("");
  const [augment3, setAugment3] = useState("");
  const [currentOffer, setCurrentOffer] = useState<string[]>([]);

  const [voiceQuery, setVoiceQuery] = useState("");

  const currentStateRef = useRef<LiveGameState | null>(null);

  // Champion names for dropdown
  const championNames = [...gameData.champions.values()]
    .map((c) => c.name)
    .sort();

  function startGame() {
    const state = createMockGameState(
      {
        championName: champion,
        gameMode,
        level,
        gold,
        gameTime,
        kills,
        deaths,
        assists,
      },
      gameData
    );
    currentStateRef.current = state;
    liveGameState$.next(state);
    setGameActive(true);
  }

  function updateState() {
    if (!currentStateRef.current) return;

    const updated = createMockGameState(
      {
        championName: champion,
        gameMode,
        level,
        gold,
        gameTime,
        kills,
        deaths,
        assists,
      },
      gameData
    );
    currentStateRef.current = updated;
    liveGameState$.next(updated);
  }

  function endGame(win: boolean) {
    if (!currentStateRef.current) return;

    const eog = createMockEogStats({
      isWin: win,
      championName: champion,
      gameLength: gameTime,
      gameMode,
    });

    // Push state with EOG stats (simulates PreEndOfGame)
    liveGameState$.next({
      ...currentStateRef.current,
      eogStats: eog,
    });

    // Then clear active player (simulates EndOfGame → None)
    setTimeout(() => {
      liveGameState$.next({
        activePlayer: null,
        players: currentStateRef.current?.players ?? [],
        gameMode: "",
        lcuGameMode: "",
        gameTime: 0,
        champSelect: null,
        eogStats: eog,
      });
      currentStateRef.current = null;
      setGameActive(false);
    }, 500);
  }

  function triggerAugmentOffer() {
    const names = [augment1, augment2, augment3].filter(Boolean);
    if (names.length < 2) return;
    setCurrentOffer(names);
    augmentOffer$.next(names);
  }

  function pickAugment(name: string) {
    augmentPicked$.next(name);
    setCurrentOffer([]);
  }

  function sendVoiceQuery() {
    if (!voiceQuery.trim()) return;
    playerIntent$.next({ type: "query", text: voiceQuery });
    setVoiceQuery("");
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const opts = preset.options;
    setChampion(opts.championName);
    setGameMode(opts.gameMode);
    setLevel(opts.level ?? 3);
    setGold(opts.gold ?? 1400);
    setGameTime(opts.gameTime ?? 0);
    setKills(opts.kills ?? 0);
    setDeaths(opts.deaths ?? 0);
    setAssists(opts.assists ?? 0);
  }

  function advanceTime(seconds: number) {
    const newTime = gameTime + seconds;
    setGameTime(newTime);
    if (currentStateRef.current) {
      const updated = { ...currentStateRef.current, gameTime: newTime };
      currentStateRef.current = updated;
      liveGameState$.next(updated);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Presets</div>
        <div className={styles.presetGrid}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={styles.presetBtn}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Game Setup</div>
        <div className={styles.row}>
          <span className={styles.label}>Champ</span>
          <select
            className={styles.select}
            value={champion}
            onChange={(e) => setChampion(e.target.value)}
          >
            {championNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Mode</span>
          <select
            className={styles.select}
            value={gameMode}
            onChange={(e) =>
              setGameMode(e.target.value as MockGameOptions["gameMode"])
            }
          >
            <option value="KIWI">ARAM Mayhem</option>
            <option value="ARAM">ARAM</option>
            <option value="CLASSIC">Classic</option>
          </select>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Level</span>
          <input
            type="number"
            className={styles.inputSmall}
            value={level}
            min={1}
            max={18}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
          <span className={styles.label}>Gold</span>
          <input
            type="number"
            className={styles.inputSmall}
            value={gold}
            onChange={(e) => setGold(Number(e.target.value))}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>KDA</span>
          <input
            type="number"
            className={styles.inputSmall}
            value={kills}
            min={0}
            onChange={(e) => setKills(Number(e.target.value))}
          />
          <span>/</span>
          <input
            type="number"
            className={styles.inputSmall}
            value={deaths}
            min={0}
            onChange={(e) => setDeaths(Number(e.target.value))}
          />
          <span>/</span>
          <input
            type="number"
            className={styles.inputSmall}
            value={assists}
            min={0}
            onChange={(e) => setAssists(Number(e.target.value))}
          />
        </div>
        <div className={styles.row}>
          {!gameActive ? (
            <button className={styles.btnPrimary} onClick={startGame}>
              Start Game
            </button>
          ) : (
            <>
              <button className={styles.btn} onClick={updateState}>
                Update State
              </button>
              <button
                className={styles.btnPrimary}
                onClick={() => endGame(true)}
              >
                Win
              </button>
              <button
                className={styles.btnDanger}
                onClick={() => endGame(false)}
              >
                Defeat
              </button>
            </>
          )}
        </div>
        {gameActive && (
          <div className={styles.row}>
            <span className={styles.label}>Time</span>
            <span className={styles.inputSmall}>
              {Math.floor(gameTime / 60)}:
              {String(Math.floor(gameTime) % 60).padStart(2, "0")}
            </span>
            <button className={styles.btn} onClick={() => advanceTime(30)}>
              +30s
            </button>
            <button className={styles.btn} onClick={() => advanceTime(60)}>
              +1m
            </button>
            <button className={styles.btn} onClick={() => advanceTime(300)}>
              +5m
            </button>
          </div>
        )}
        <div
          className={`${styles.status} ${gameActive ? styles.statusActive : ""}`}
        >
          {gameActive ? `In game: ${champion} (${gameMode})` : "No game"}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Augment Offer</div>
        <div className={styles.row}>
          <input
            className={styles.augmentInput}
            placeholder="Augment 1"
            value={augment1}
            onChange={(e) => setAugment1(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <input
            className={styles.augmentInput}
            placeholder="Augment 2"
            value={augment2}
            onChange={(e) => setAugment2(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <input
            className={styles.augmentInput}
            placeholder="Augment 3"
            value={augment3}
            onChange={(e) => setAugment3(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button className={styles.btn} onClick={triggerAugmentOffer}>
            Send Offer
          </button>
        </div>
        {currentOffer.length > 0 && (
          <div className={styles.row}>
            {currentOffer.map((name) => (
              <button
                key={name}
                className={styles.augmentPickBtn}
                onClick={() => pickAugment(name)}
              >
                Pick {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Voice Query</div>
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="What should I buy next?"
            value={voiceQuery}
            onChange={(e) => setVoiceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendVoiceQuery();
            }}
          />
        </div>
        <div className={styles.row}>
          <button className={styles.btn} onClick={sendVoiceQuery}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
