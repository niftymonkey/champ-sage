import type { EffectivePlayer } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { primaryClassTag } from "../lib/champion-class";
import styles from "./EnemyStrip.module.css";

interface EnemyStripProps {
  enemies: EffectivePlayer[];
  gameData: LoadedGameData;
}

/**
 * Compact enemy-team list for the in-game right column. Layout matches
 * the v16 design: per-enemy row with tile + name + class tag + role
 * descriptor.
 *
 * Two design fields are intentionally not yet populated — both require
 * analysis we don't compute today:
 *   - Threat tier (hi/md/lo coloring per row).
 *   - Role descriptor ("220 armor", "behind", "dot · poke").
 * Until those land we substitute the player level for the role slot.
 */
export function EnemyStrip({ enemies, gameData }: EnemyStripProps) {
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
          />
        ))}
      </div>
    </div>
  );
}

function EnemyRow({
  enemy,
  gameData,
}: {
  enemy: EffectivePlayer;
  gameData: LoadedGameData;
}) {
  const champion = gameData.champions.get(enemy.championName.toLowerCase());
  const tag = primaryClassTag(champion?.tags ?? []);
  return (
    <div className={styles.row}>
      <div className={styles.tile}>
        {champion?.image ? (
          <img src={champion.image} alt="" loading="lazy" />
        ) : null}
      </div>
      <span className={styles.name}>{enemy.championName}</span>
      {tag ? (
        <span className={`${styles.tag} ${styles[`tag_${tag}`] ?? ""}`}>
          {tag}
        </span>
      ) : (
        <span />
      )}
      <span className={styles.role}>Lv {enemy.level}</span>
    </div>
  );
}
