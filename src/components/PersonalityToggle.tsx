import { useEffect, useState } from "react";
import {
  PERSONALITIES,
  personality$,
  setPersonality,
} from "../lib/ai/personality-store";
import type { PersonalityLayer } from "../lib/ai/personality";
import styles from "./PersonalityToggle.module.css";

const LABELS: Record<string, string> = {
  brief: "Brief",
  pirate: "Pirate",
};

export function PersonalityToggle() {
  const [current, setCurrent] = useState<PersonalityLayer>(
    personality$.getValue()
  );

  useEffect(() => {
    const sub = personality$.subscribe(setCurrent);
    return () => sub.unsubscribe();
  }, []);

  return (
    <div className={styles.toggle}>
      <span className={styles.label}>Voice</span>
      <div className={styles.buttons}>
        {PERSONALITIES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={
              p.id === current.id
                ? `${styles.button} ${styles.active}`
                : styles.button
            }
            onClick={() => setPersonality(p)}
          >
            {LABELS[p.id] ?? p.id}
          </button>
        ))}
      </div>
    </div>
  );
}
