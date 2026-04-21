import type { CoachingFeature } from "../../feature";
import type { CoachingResponse } from "../../types";
import type { LoadedGameData } from "../../../data-ingest";
import { coachingResponseSchema } from "../../schemas";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { formatAugmentOfferLines } from "../../augment-offer-formatter";
import { AUGMENT_FIT_TASK_PROMPT } from "./prompt";

export interface AugmentFitInput {
  readonly snapshot: GameSnapshot | null;
  readonly augmentNames: readonly string[];
  readonly chosenAugments: readonly string[];
  readonly gameData: LoadedGameData;
}

export const augmentFitFeature: CoachingFeature<
  AugmentFitInput,
  CoachingResponse
> = {
  id: "augment-fit",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => `\n\n${AUGMENT_FIT_TASK_PROMPT}`,

  buildUserMessage: ({ snapshot, augmentNames, chosenAugments, gameData }) => {
    const snapshotText = snapshot ? formatStateSnapshot(snapshot) : "";
    const options = augmentNames
      .map((name) => gameData.augments.get(name.toLowerCase()))
      .filter((aug): aug is NonNullable<typeof aug> => aug != null)
      .map((aug) => ({
        name: aug.name,
        description: aug.description,
        tier: aug.tier,
        sets: aug.sets,
      }));
    const offerLines = formatAugmentOfferLines(
      options,
      [...chosenAugments],
      gameData
    );
    const question = [
      `I'm being offered these augments: ${augmentNames.join(", ")}. How well does each fit my current build?`,
      "",
      "Augment options:",
      ...offerLines,
    ].join("\n");
    return `[Game State]\n${snapshotText}\n\n[Question]\n${question}`;
  },

  outputSchema: coachingResponseSchema,

  extractResult: (raw, meta) =>
    meta.retried ? { ...raw, retried: true } : raw,
};
