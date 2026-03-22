import { useState, useEffect } from "react";
import type { AppNotification } from "../lib/reactive";
import { notifications$ } from "../lib/reactive";

const AUTO_DISMISS_MS = 5000;

export function useNotifications(): AppNotification[] {
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    const sub = notifications$.subscribe((notification) => {
      setItems((prev) => [...prev, notification]);

      // Auto-dismiss after timeout
      setTimeout(() => {
        setItems((prev) => prev.filter((n) => n.id !== notification.id));
      }, AUTO_DISMISS_MS);
    });
    return () => sub.unsubscribe();
  }, []);

  return items;
}
