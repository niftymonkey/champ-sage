import { useState, useEffect } from "react";
import type { AppNotification } from "../lib/reactive";
import { notifications$ } from "../lib/reactive";

const AUTO_DISMISS_MS = 5000;

export function useNotifications(): AppNotification[] {
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const sub = notifications$.subscribe((notification) => {
      setItems((prev) => [...prev, notification]);
      const timer = setTimeout(() => {
        setItems((prev) => prev.filter((n) => n.id !== notification.id));
        timers.delete(timer);
      }, AUTO_DISMISS_MS);
      timers.add(timer);
    });
    return () => {
      sub.unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return items;
}
