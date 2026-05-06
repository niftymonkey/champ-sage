import { defineBoolean, defineEnum } from "./define";
import type { AnySetting, SettingGroup } from "./types";

/**
 * Every persisted user preference declared in one place. Adding a new
 * setting is a one-line entry here plus an entry in `SETTING_GROUPS`
 * if it should appear in the Settings UI.
 *
 * Storage keys are namespaced under `settings.*` so the on-disk JSON
 * stays readable. Renaming a key is a migration concern (orphaned keys
 * don't break anything; they just become dead weight).
 */

export const postGameTakeaway = defineBoolean({
  key: "postGameTakeaway",
  storageKey: "settings.postGameTakeaway",
  label: "Post-game takeaway",
  description: "Generate a short LLM reflection after each match.",
  defaultValue: false,
});

export type PersonalityId = "brief" | "pirate";

export const personality = defineEnum<PersonalityId>({
  key: "personality",
  // Existing key from the legacy personality-store; preserved so
  // anyone with a saved preference doesn't lose it on upgrade.
  storageKey: "personality.id",
  label: "Coach voice",
  description: "How the coach phrases recommendations.",
  defaultValue: "brief",
  options: [
    { value: "brief", label: "Brief" },
    { value: "pirate", label: "Pirate" },
  ],
});

/**
 * Single registry the store iterates at boot to hydrate every
 * known setting. Keep this list in sync with anything that calls
 * `getSetting` / `setSetting`.
 */
export const ALL_SETTINGS: ReadonlyArray<AnySetting> = [
  postGameTakeaway,
  personality,
];

/**
 * Grouped layout for the Settings UI. Settings can appear in only
 * one group; ordering inside the array is the render order.
 */
export const SETTING_GROUPS: ReadonlyArray<SettingGroup> = [
  {
    id: "coach-features",
    title: "Coach features",
    caption: "Toggles · LLM",
    settings: [postGameTakeaway],
  },
  {
    id: "coach-voice",
    title: "Coach voice",
    caption: "Tone + speed",
    settings: [personality],
  },
];
