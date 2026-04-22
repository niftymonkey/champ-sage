import type { CoachingFeature } from "../../feature";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { VOICE_QUERY_TASK_PROMPT } from "./prompt";
import { voiceQuerySchema, type VoiceQueryResult } from "./schema";

export type { VoiceQueryResult } from "./schema";

export interface VoiceQueryInput {
  readonly snapshot: GameSnapshot | null;
  readonly question: string;
}

export const voiceQueryFeature: CoachingFeature<
  VoiceQueryInput,
  VoiceQueryResult
> = {
  id: "voice-query",
  supportedPhases: ["in-game"] as const,

  buildTaskPrompt: () => `\n\n${VOICE_QUERY_TASK_PROMPT}`,

  buildUserMessage: ({ snapshot, question }) => {
    const snapshotText = snapshot ? formatStateSnapshot(snapshot) : "";
    return `[Game State]\n${snapshotText}\n\n[Question]\n${question}`;
  },

  outputSchema: voiceQuerySchema,

  extractResult: (raw) => raw,

  summarizeForHistory: (result) => result.answer,
};
