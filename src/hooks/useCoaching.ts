import { useState, useEffect } from "react";
import type { CoachingMessage } from "../lib/reactive";
import { coaching$ } from "../lib/reactive";

export function useCoaching(): CoachingMessage[] {
  const [messages, setMessages] = useState<CoachingMessage[]>([]);

  useEffect(() => {
    const sub = coaching$.subscribe((msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return () => sub.unsubscribe();
  }, []);

  return messages;
}
