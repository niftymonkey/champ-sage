import { useEffect, useRef } from "react";
import { useCoachingFeed } from "../../hooks/useCoachingFeed";
import { CoachingCard } from "./CoachingCard";
import styles from "./CoachingFeed.module.css";

export function CoachingFeed() {
  const feed = useCoachingFeed();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The redesign pins the feed to the bottom: oldest entries scroll out the
  // top edge under a fade. Auto-scroll on every new entry so the freshest
  // turn is always in view. Phase 4 will add the "user has scrolled up"
  // detection and the "N new" badge per the spec.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  return (
    <div className={styles.feed}>
      <div className={styles.heading}>
        <h2 className={styles.headingTitle}>Conversation</h2>
        <span className={styles.headingMeta}>
          {feed.length === 0
            ? "Waiting for first turn"
            : `${feed.length} ${feed.length === 1 ? "turn" : "turns"} woven`}
        </span>
      </div>
      <div className={styles.scroll} ref={scrollRef}>
        {feed.length === 0 ? (
          <div className={styles.placeholder}>
            The coach will weigh in once the game gets going.
          </div>
        ) : (
          feed.map((entry) => <CoachingCard key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
