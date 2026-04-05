import { useState, useEffect } from "react";
import type { GamePlan } from "../lib/reactive/coaching-feed-types";
import { gamePlan$ } from "../lib/reactive/coaching-feed";

export function useGamePlan(): GamePlan | null {
  const [plan, setPlan] = useState<GamePlan | null>(gamePlan$.getValue());

  useEffect(() => {
    const sub = gamePlan$.subscribe(setPlan);
    return () => sub.unsubscribe();
  }, []);

  return plan;
}
