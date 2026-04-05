import type { EffectivePlayer } from "../lib/mode/types";
import type { LoadedGameData } from "../lib/data-ingest";
import { deriveItemCategories } from "../lib/item-categories";
import styles from "./EnemyStrip.module.css";

interface EnemyStripProps {
  enemies: EffectivePlayer[];
  gameData: LoadedGameData;
}

export function EnemyStrip({ enemies, gameData }: EnemyStripProps) {
  if (enemies.length === 0) return null;

  return (
    <div className={styles.strip}>
      <div className={styles.title}>Enemy Team</div>
      <div className={styles.grid}>
        {enemies.map((enemy) => (
          <EnemyCard
            key={enemy.riotIdGameName}
            enemy={enemy}
            gameData={gameData}
          />
        ))}
      </div>
    </div>
  );
}

interface EnemyCardProps {
  enemy: EffectivePlayer;
  gameData: LoadedGameData;
}

function EnemyCard({ enemy, gameData }: EnemyCardProps) {
  const itemsWithStats = enemy.items.map((pi) => {
    const fullItem = gameData.items.get(pi.id);
    return fullItem
      ? { name: pi.name, stats: fullItem.stats, tags: fullItem.tags }
      : { name: pi.name, stats: {}, tags: [] };
  });

  const categories = deriveItemCategories(itemsWithStats);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.champName}>{enemy.championName}</span>
        <span className={styles.level}>Lv{enemy.level}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.items}>
          {itemsWithStats.map((item, i) => (
            <span
              key={`${enemy.riotIdGameName}-${i}`}
              className={styles.item}
              title={item.name}
            >
              {item.name}
            </span>
          ))}
        </div>
        {categories.length > 0 && (
          <div className={styles.pills}>
            {categories.map((cat) => (
              <span key={cat} className={styles.pill}>
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
