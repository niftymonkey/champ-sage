import type { EffectivePlayer } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { useCoachingContext } from "../hooks/useCoachingContext";
import {
  label as directionLabel,
  type BuildDirection,
} from "../lib/build-direction/taxonomy";
import type { DirectionReading } from "../lib/build-direction/inference";
import styles from "./EnemyStrip.module.css";

interface EnemyStripProps {
  enemies: EffectivePlayer[];
  gameData: LoadedGameData;
}

/**
 * Compact enemy-team list for the in-game right column. Per-enemy row
 * with tile + name + build-direction tag + role descriptor.
 *
 * The tag tracks `enemyDirections` from CoachingContext: stereotype at
 * cold-start (rendered muted), evidence-derived once items accumulate
 * (rendered in the direction's color).
 *
 * Role descriptor ("220 armor", "behind", "dot · poke") is still not
 * computed; player level substitutes until that signal lands.
 */
export function EnemyStrip({ enemies, gameData }: EnemyStripProps) {
  const { enemyDirections } = useCoachingContext();

  if (enemies.length === 0) return null;

  return (
    <div className={styles.strip}>
      <div className={styles.heading}>
        <span className={styles.headingTitle}>Enemy team</span>
        <span className={styles.headingMeta}>what they're building</span>
      </div>
      <div className={styles.list}>
        {enemies.map((enemy) => (
          <EnemyRow
            key={enemy.riotIdGameName}
            enemy={enemy}
            gameData={gameData}
            reading={enemyDirections.get(enemy.championName)}
          />
        ))}
      </div>
    </div>
  );
}

function EnemyRow({
  enemy,
  gameData,
  reading,
}: {
  enemy: EffectivePlayer;
  gameData: LoadedGameData;
  reading: DirectionReading | undefined;
}) {
  const champion = gameData.champions.get(enemy.championName.toLowerCase());
  return (
    <div className={styles.row}>
      <div className={styles.tile}>
        {champion?.image ? (
          <img src={champion.image} alt="" loading="lazy" />
        ) : null}
      </div>
      <span className={styles.name}>{enemy.championName}</span>
      <DirectionTag reading={reading} />
      <span className={styles.role}>Lv {enemy.level}</span>
    </div>
  );
}

function DirectionTag({ reading }: { reading: DirectionReading | undefined }) {
  if (!reading) return <span />;
  const muted = reading.confidence === "stereotype";
  const className = [
    styles.tag,
    styles[`tag_${reading.direction satisfies BuildDirection}`],
    muted ? styles.tagMuted : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={className}>{directionLabel(reading.direction)}</span>;
}
