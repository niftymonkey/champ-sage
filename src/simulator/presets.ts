/**
 * Preset game scenarios for quick simulator testing.
 */

import type { MockGameOptions } from "./mock-state";

export interface Preset {
  label: string;
  options: MockGameOptions;
}

export const PRESETS: Preset[] = [
  {
    label: "Early ARAM Mayhem",
    options: {
      championName: "Ahri",
      gameMode: "KIWI",
      level: 3,
      gold: 1400,
      gameTime: 30,
    },
  },
  {
    label: "Mid Game (Items)",
    options: {
      championName: "Ahri",
      gameMode: "KIWI",
      level: 10,
      gold: 2500,
      gameTime: 600,
      kills: 5,
      deaths: 2,
      assists: 8,
    },
  },
  {
    label: "Late Game Full Build",
    options: {
      championName: "Jinx",
      gameMode: "KIWI",
      level: 18,
      gold: 500,
      gameTime: 1500,
      kills: 12,
      deaths: 4,
      assists: 15,
    },
  },
  {
    label: "Classic SR Mid",
    options: {
      championName: "Ahri",
      gameMode: "CLASSIC",
      level: 8,
      gold: 450,
      gameTime: 600,
      kills: 2,
      deaths: 1,
      assists: 3,
    },
  },
  {
    label: "Straight ARAM",
    options: {
      championName: "Garen",
      gameMode: "ARAM",
      level: 6,
      gold: 2000,
      gameTime: 300,
      kills: 1,
      deaths: 3,
      assists: 4,
    },
  },
];
