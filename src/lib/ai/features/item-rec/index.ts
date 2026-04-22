import type { CoachingFeature } from "../../feature";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { ITEM_REC_TASK_PROMPT } from "./prompt";
import { itemRecSchema, type ItemRecResult } from "./schema";

export type { ItemRecResult } from "./schema";

export interface ItemRecInput {
  readonly snapshot: GameSnapshot | null;
  readonly question: string;
}

export const itemRecFeature: CoachingFeature<ItemRecInput, ItemRecResult> = {
  id: "item-rec",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => `\n\n${ITEM_REC_TASK_PROMPT}`,

  buildUserMessage: ({ snapshot, question }) => {
    const snapshotText = snapshot ? formatStateSnapshot(snapshot) : "";
    return `[Game State]\n${snapshotText}\n\n[Question]\n${question}`;
  },

  outputSchema: itemRecSchema,

  extractResult: (raw) => raw,
};
