import type {
  AugmentDecision,
  DecisionRecord,
  GameSummary,
  ItemRecDecision,
  PlanDecision,
  TakeawayDecision,
  ThreatSpikeDecision,
  VoiceDecision,
} from "./types";

/**
 * Reduce a list of decision records (typically one game's slice) into a
 * render-ready summary. Pure: no I/O, no clock, no allocation beyond the
 * returned shape. Caller is responsible for passing records that belong
 * together — the function does not validate gameId homogeneity, it just
 * uses the first record's identity for the summary header fields.
 */
export function summarizeGame(records: DecisionRecord[]): GameSummary {
  if (records.length === 0) {
    return emptySummary();
  }

  const voice: VoiceDecision[] = [];
  const plan: PlanDecision[] = [];
  const augment: AugmentDecision[] = [];
  const itemRec: ItemRecDecision[] = [];
  const threatSpike: ThreatSpikeDecision[] = [];
  const takeaway: TakeawayDecision[] = [];

  let startedAt = records[0].sentAt;
  let endedAt = records[0].sentAt;
  let retriedCount = 0;
  let finalPlan: PlanDecision | null = null;
  let latestTakeaway: TakeawayDecision | null = null;

  for (const r of records) {
    if (r.sentAt < startedAt) startedAt = r.sentAt;
    if (r.sentAt > endedAt) endedAt = r.sentAt;
    if (r.retried) retriedCount += 1;

    switch (r.source) {
      case "voice":
        voice.push(r);
        break;
      case "plan":
        plan.push(r);
        if (finalPlan === null || r.rev > finalPlan.rev) finalPlan = r;
        break;
      case "augment":
        augment.push(r);
        break;
      case "item-rec":
        itemRec.push(r);
        break;
      case "threat-spike":
        threatSpike.push(r);
        break;
      case "takeaway":
        takeaway.push(r);
        if (latestTakeaway === null || r.sentAt > latestTakeaway.sentAt) {
          latestTakeaway = r;
        }
        break;
    }
  }

  const bySentAt = (a: { sentAt: number }, b: { sentAt: number }) =>
    a.sentAt - b.sentAt;
  voice.sort(bySentAt);
  plan.sort(bySentAt);
  augment.sort(bySentAt);
  itemRec.sort(bySentAt);
  threatSpike.sort(bySentAt);
  takeaway.sort(bySentAt);

  return {
    gameId: records[0].gameId,
    gameMode: records[0].gameMode,
    startedAt,
    endedAt,
    byKind: { voice, plan, augment, itemRec, threatSpike, takeaway },
    finalPlan,
    takeaway: latestTakeaway,
    retriedCount,
    totalCount: records.length,
  };
}

function emptySummary(): GameSummary {
  return {
    gameId: null,
    gameMode: null,
    startedAt: null,
    endedAt: null,
    byKind: {
      voice: [],
      plan: [],
      augment: [],
      itemRec: [],
      threatSpike: [],
      takeaway: [],
    },
    finalPlan: null,
    takeaway: null,
    retriedCount: 0,
    totalCount: 0,
  };
}
