import type { CoachingFeature } from "../../feature";
import type { CoachingResponse } from "../../types";
import { coachingResponseSchema } from "../../schemas";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { ITEM_REC_TASK_PROMPT } from "./prompt";

export interface ItemRecInput {
  readonly snapshot: GameSnapshot | null;
  readonly question: string;
}

export const itemRecFeature: CoachingFeature<ItemRecInput, CoachingResponse> = {
  id: "item-rec",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => `\n\n${ITEM_REC_TASK_PROMPT}`,

  buildUserMessage: ({ snapshot, question }) => {
    const snapshotText = snapshot ? formatStateSnapshot(snapshot) : "";
    return `[Game State]\n${snapshotText}\n\n[Question]\n${question}`;
  },

  outputSchema: coachingResponseSchema,

  extractResult: (raw, meta) =>
    meta.retried ? { ...raw, retried: true } : raw,
};
