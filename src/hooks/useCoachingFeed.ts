import { useState, useEffect } from "react";
import type { AnyFeedEntry } from "../lib/reactive/coaching-feed-types";
import { coachingFeed$ } from "../lib/reactive/coaching-feed";

export function useCoachingFeed(): AnyFeedEntry[] {
  const [feed, setFeed] = useState<AnyFeedEntry[]>(coachingFeed$.getValue());

  useEffect(() => {
    const sub = coachingFeed$.subscribe(setFeed);
    return () => sub.unsubscribe();
  }, []);

  return feed;
}
