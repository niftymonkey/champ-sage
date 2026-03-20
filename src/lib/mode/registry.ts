import type { GameMode, ModeRegistry } from "./types";

export function createModeRegistry(): ModeRegistry {
  const modes: GameMode[] = [];

  return {
    register(mode: GameMode): void {
      modes.push(mode);
    },

    detect(gameMode: string): GameMode | null {
      for (const mode of modes) {
        if (mode.matches(gameMode)) return mode;
      }
      return null;
    },
  };
}
