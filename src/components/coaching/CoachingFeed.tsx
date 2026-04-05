import { useCoachingFeed } from "../../hooks/useCoachingFeed";
import { CoachingCard } from "./CoachingCard";
import styles from "./CoachingFeed.module.css";

export function CoachingFeed() {
  const feed = useCoachingFeed();

  // Display newest entries at top
  const reversed = [...feed].reverse();

  if (reversed.length === 0) {
    return (
      <div className={styles.feed}>
        <div className={styles.placeholder}>Waiting for game plan...</div>
      </div>
    );
  }

  return (
    <div className={styles.feed}>
      {reversed.map((entry) => (
        <CoachingCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
