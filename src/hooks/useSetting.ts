import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting, settings$ } from "../lib/settings/runtime";
import type { AnySetting, SettingValue } from "../lib/settings/types";

/**
 * React-friendly subscription to a single setting. Returns `[value,
 * setValue]` modeled after `useState`. The `setValue` writes through
 * to disk; the next subject emission re-renders any subscriber.
 */
export function useSetting<S extends AnySetting>(
  setting: S
): [SettingValue<S>, (next: SettingValue<S>) => Promise<void>] {
  const [value, setValue] = useState<SettingValue<S>>(() =>
    getSetting(setting)
  );

  useEffect(() => {
    const sub = settings$.subscribe(() => {
      setValue(getSetting(setting));
    });
    return () => sub.unsubscribe();
  }, [setting]);

  const update = useCallback(
    (next: SettingValue<S>) => setSetting(setting, next),
    [setting]
  );

  return [value, update];
}
