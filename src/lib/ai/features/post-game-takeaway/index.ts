import type { CoachingFeature } from "../../feature";
import { POST_GAME_TAKEAWAY_TASK_PROMPT } from "./prompt";
import { postGameTakeawaySchema, type PostGameTakeawayResult } from "./schema";

export type { PostGameTakeawayResult } from "./schema";

/**
 * Inputs the post-game-takeaway feature builds its message from. Pure
 * data — the caller assembles these from eogStats + the just-ended
 * game's decision-log slice.
 */
export interface PostGameTakeawayInput {
  readonly champion: string;
  readonly gameMode: string;
  readonly isWin: boolean;
  readonly duration: number;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly finalGold: number | null;
  readonly finalItems: readonly string[];
  readonly recommendedBuild: readonly string[];
  readonly augmentsPicked: readonly string[];
  readonly voiceExchanges: ReadonlyArray<{
    question: string;
    answer: string;
  }>;
  readonly planRevisionCount: number;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBuildComparison(
  finalItems: readonly string[],
  recommendedBuild: readonly string[]
): string {
  if (recommendedBuild.length === 0) {
    return finalItems.length > 0
      ? `Final items: ${finalItems.join(", ")}.\nNo coach-recommended build was generated.`
      : "No final items captured. No coach-recommended build was generated.";
  }
  const matched = finalItems.filter((i) => recommendedBuild.includes(i));
  const missed = recommendedBuild.filter((i) => !finalItems.includes(i));
  return [
    `Final items: ${finalItems.join(", ") || "—"}.`,
    `Coach recommended: ${recommendedBuild.join(", ")}.`,
    `Matched ${matched.length} of ${recommendedBuild.length} recommended items.`,
    missed.length > 0 ? `Missed: ${missed.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatVoiceExchanges(
  exchanges: PostGameTakeawayInput["voiceExchanges"]
): string {
  if (exchanges.length === 0) return "No voice questions asked.";
  return exchanges
    .map((e, i) => `Q${i + 1}: ${e.question}\nA${i + 1}: ${e.answer}`)
    .join("\n\n");
}

export const postGameTakeawayFeature: CoachingFeature<
  PostGameTakeawayInput,
  PostGameTakeawayResult
> = {
  id: "post-game-takeaway",
  supportedPhases: ["post-game"] as const,

  buildTaskPrompt: () => `\n\n${POST_GAME_TAKEAWAY_TASK_PROMPT}`,

  buildUserMessage: (input) => {
    const result = input.isWin ? "victory" : "defeat";
    const augLine =
      input.augmentsPicked.length > 0
        ? `Augments picked: ${input.augmentsPicked.join(", ")}.`
        : "No augments picked.";
    return [
      "[Game Summary]",
      `${input.champion} · ${input.gameMode} · ${result} · ${formatDuration(input.duration)}`,
      `KDA: ${input.kills}/${input.deaths}/${input.assists}`,
      input.finalGold !== null ? `Final gold: ${input.finalGold}.` : "",
      "",
      formatBuildComparison(input.finalItems, input.recommendedBuild),
      "",
      augLine,
      `Plan revisions during the game: ${input.planRevisionCount}.`,
      "",
      "[Voice Exchanges]",
      formatVoiceExchanges(input.voiceExchanges),
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  },

  outputSchema: postGameTakeawaySchema,

  extractResult: (raw) => raw,

  summarizeForHistory: (result) => result.narrative,
};
