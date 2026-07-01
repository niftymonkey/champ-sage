import { describe, it, expect } from "vitest";
import {
  extractMatchData,
  countMatchesInWindow,
  selectRecentInWindowMatchIds,
  selectChampionParticipants,
  computeFreshShare,
  aggregateBuilds,
  CHAMPION_PARTICIPANT_TARGET,
  ITEM_POOL_PRESENCE_FLOOR,
  ITEM_POOL_MAX_SIZE,
  type MatchData,
  type ParticipantData,
  type WindowedParticipant,
  type QueueMeta,
} from "./aggregation";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fixed reference time so window math is deterministic across the suite.
const NOW_MS = Date.UTC(2026, 5, 16); // 2026-06-16

function daysAgoMs(days: number): number {
  return NOW_MS - days * MS_PER_DAY;
}

const ARAM_QUEUE: QueueMeta = { id: 450, name: "ARAM" };

function createPerks(): ParticipantData["perks"] {
  return {
    statPerks: { defense: 5002, flex: 5008, offense: 5005 },
    styles: [
      {
        description: "primaryStyle",
        style: 8000,
        selections: [{ perk: 8005 }, { perk: 9111 }],
      },
    ],
  };
}

function createParticipant(
  overrides: Partial<ParticipantData> = {}
): ParticipantData {
  return {
    puuid: "puuid-default",
    championId: 222,
    championName: "Jinx",
    win: true,
    items: [3031, 6672, 3094, 3036, 3072, 3026, 3340],
    perks: createPerks(),
    teamPosition: "BOTTOM",
    augments: [],
    summonerSpells: [4, 6], // Flash + Ghost
    ...overrides,
  };
}

function createMatch(overrides: Partial<MatchData> = {}): MatchData {
  return {
    matchId: "NA1_000",
    queueId: 450,
    gameVersion: "16.12.123.456",
    gameDuration: 1800,
    gameEndTimestamp: NOW_MS,
    participants: [createParticipant()],
    ...overrides,
  };
}

function createWindowedParticipant(
  overrides: {
    participant?: Partial<ParticipantData>;
    gameEndTimestamp?: number;
    gameVersion?: string;
  } = {}
): WindowedParticipant {
  return {
    participant: createParticipant(overrides.participant),
    gameEndTimestamp: overrides.gameEndTimestamp ?? NOW_MS,
    gameVersion: overrides.gameVersion ?? "16.12.123.456",
  };
}

describe("extractMatchData", () => {
  it("captures gameEndTimestamp from info.gameEndTimestamp (milliseconds)", () => {
    const endMs = daysAgoMs(3);
    const raw = {
      info: {
        queueId: 450,
        gameVersion: "16.12.1.1",
        gameDuration: 1500,
        gameEndTimestamp: endMs,
        participants: [
          {
            puuid: "p1",
            championId: 222,
            championName: "Jinx",
            win: true,
            item0: 3031,
            item1: 6672,
            item2: 3094,
            item3: 0,
            item4: 0,
            item5: 0,
            item6: 3340,
            perks: createPerks(),
            teamPosition: "BOTTOM",
          },
        ],
      },
    };

    const match = extractMatchData("NA1_42", raw);
    expect(match).not.toBeNull();
    expect(match?.gameEndTimestamp).toBe(endMs);
    expect(match?.matchId).toBe("NA1_42");
    expect(match?.gameVersion).toBe("16.12.1.1");
    expect(match?.participants[0].championId).toBe(222);
  });

  it("captures summoner spells from summoner1Id/summoner2Id", () => {
    const raw = {
      info: {
        queueId: 450,
        gameVersion: "16.12.1.1",
        gameDuration: 1500,
        gameEndTimestamp: daysAgoMs(1),
        participants: [
          {
            puuid: "p1",
            championId: 222,
            championName: "Jinx",
            win: true,
            item0: 3031,
            item1: 6672,
            item2: 3094,
            item3: 0,
            item4: 0,
            item5: 0,
            item6: 3340,
            perks: createPerks(),
            teamPosition: "BOTTOM",
            summoner1Id: 4,
            summoner2Id: 7,
          },
        ],
      },
    };

    const match = extractMatchData("NA1_77", raw);
    expect(match?.participants[0].summonerSpells).toEqual([4, 7]);
  });

  it("yields an empty spell pair when summoner spell fields are absent", () => {
    const raw = {
      info: {
        queueId: 450,
        gameVersion: "16.12.1.1",
        gameDuration: 1500,
        gameEndTimestamp: daysAgoMs(1),
        participants: [
          {
            puuid: "p1",
            championId: 222,
            championName: "Jinx",
            win: true,
            item0: 3031,
            item1: 6672,
            item2: 3094,
            item3: 0,
            item4: 0,
            item5: 0,
            item6: 3340,
            perks: createPerks(),
            teamPosition: "BOTTOM",
          },
        ],
      },
    };

    const match = extractMatchData("NA1_78", raw);
    expect(match?.participants[0].summonerSpells).toEqual([]);
  });

  it("returns null when info is missing", () => {
    expect(extractMatchData("NA1_0", {})).toBeNull();
  });
});

describe("countMatchesInWindow", () => {
  it("counts only matches at or after the cutoff", () => {
    const matches = [
      createMatch({ matchId: "a", gameEndTimestamp: daysAgoMs(2) }),
      createMatch({ matchId: "b", gameEndTimestamp: daysAgoMs(5) }),
      createMatch({ matchId: "c", gameEndTimestamp: daysAgoMs(20) }),
    ];
    // 7-day cutoff includes a (2d) and b (5d), excludes c (20d).
    const cutoff = daysAgoMs(7);
    expect(countMatchesInWindow(matches, cutoff)).toBe(2);
  });

  it("treats a missing/zero timestamp as 0 (excluded from every window)", () => {
    const matches = [
      createMatch({ matchId: "fresh", gameEndTimestamp: daysAgoMs(1) }),
      createMatch({ matchId: "legacy", gameEndTimestamp: 0 }),
    ];
    const cutoff = daysAgoMs(60);
    expect(countMatchesInWindow(matches, cutoff)).toBe(1);
  });
});

describe("selectRecentInWindowMatchIds", () => {
  it("returns the n most recent in-window match ids, newest first", () => {
    const matches = [
      createMatch({ matchId: "old", gameEndTimestamp: daysAgoMs(10) }),
      createMatch({ matchId: "newest", gameEndTimestamp: daysAgoMs(1) }),
      createMatch({ matchId: "mid", gameEndTimestamp: daysAgoMs(4) }),
    ];
    expect(selectRecentInWindowMatchIds(matches, daysAgoMs(30), 2)).toEqual([
      "newest",
      "mid",
    ]);
  });

  it("excludes matches older than the cutoff and legacy zero-timestamp ones", () => {
    const matches = [
      createMatch({ matchId: "in", gameEndTimestamp: daysAgoMs(3) }),
      createMatch({ matchId: "out", gameEndTimestamp: daysAgoMs(40) }),
      createMatch({ matchId: "legacy", gameEndTimestamp: 0 }),
    ];
    expect(selectRecentInWindowMatchIds(matches, daysAgoMs(30), 10)).toEqual([
      "in",
    ]);
  });

  it("returns at most n ids", () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      createMatch({ matchId: `m${i}`, gameEndTimestamp: daysAgoMs(i + 1) })
    );
    expect(
      selectRecentInWindowMatchIds(matches, daysAgoMs(30), 3)
    ).toHaveLength(3);
  });

  it("returns an empty array when nothing is in window", () => {
    const matches = [
      createMatch({ matchId: "old", gameEndTimestamp: daysAgoMs(60) }),
    ];
    expect(selectRecentInWindowMatchIds(matches, daysAgoMs(30), 5)).toEqual([]);
  });
});

describe("selectChampionParticipants", () => {
  const LADDER = [7, 14, 30, 60];

  it("uses only 7d data when the champion has >=K participants in the 7d window", () => {
    const participants: WindowedParticipant[] = [];
    // K within 7 days.
    for (let i = 0; i < CHAMPION_PARTICIPANT_TARGET; i++) {
      participants.push(
        createWindowedParticipant({ gameEndTimestamp: daysAgoMs(3) })
      );
    }
    // Plenty more in the 14d window that must NOT be used.
    for (let i = 0; i < 50; i++) {
      participants.push(
        createWindowedParticipant({ gameEndTimestamp: daysAgoMs(10) })
      );
    }

    const result = selectChampionParticipants(
      participants,
      LADDER,
      NOW_MS,
      CHAMPION_PARTICIPANT_TARGET
    );
    expect(result.windowDaysUsed).toBe(7);
    expect(result.participants.length).toBe(CHAMPION_PARTICIPANT_TARGET);
  });

  it("backfills to 14d when below K at 7d but >=K at 14d", () => {
    const participants: WindowedParticipant[] = [];
    // 10 in the 7d window.
    for (let i = 0; i < 10; i++) {
      participants.push(
        createWindowedParticipant({ gameEndTimestamp: daysAgoMs(2) })
      );
    }
    // 40 more in the 8..14d band, total 50 within 14d (>= K).
    for (let i = 0; i < 40; i++) {
      participants.push(
        createWindowedParticipant({ gameEndTimestamp: daysAgoMs(12) })
      );
    }

    const result = selectChampionParticipants(
      participants,
      LADDER,
      NOW_MS,
      CHAMPION_PARTICIPANT_TARGET
    );
    expect(result.windowDaysUsed).toBe(14);
    // All 50 within the 14d window are eligible once we settle on 14d.
    expect(result.participants.length).toBe(50);
  });

  it("uses all available at the widest window when K is never reached", () => {
    const participants: WindowedParticipant[] = [];
    // Only 5 total, scattered, fewer than K at every rung.
    participants.push(
      createWindowedParticipant({ gameEndTimestamp: daysAgoMs(3) })
    );
    participants.push(
      createWindowedParticipant({ gameEndTimestamp: daysAgoMs(10) })
    );
    participants.push(
      createWindowedParticipant({ gameEndTimestamp: daysAgoMs(25) })
    );
    participants.push(
      createWindowedParticipant({ gameEndTimestamp: daysAgoMs(45) })
    );
    // One outside the 60d ladder entirely: still used at the widest rung,
    // since "use all available" applies when K is never reached.
    participants.push(
      createWindowedParticipant({ gameEndTimestamp: daysAgoMs(90) })
    );

    const result = selectChampionParticipants(
      participants,
      LADDER,
      NOW_MS,
      CHAMPION_PARTICIPANT_TARGET
    );
    expect(result.windowDaysUsed).toBe(60);
    expect(result.participants.length).toBe(5);
  });
});

describe("computeFreshShare", () => {
  it("returns 1.0 when all used participants are on the target patch", () => {
    const used = [
      createWindowedParticipant({ gameVersion: "16.12.1.1" }),
      createWindowedParticipant({ gameVersion: "16.12.500.999" }),
    ];
    expect(computeFreshShare(used, "16.12")).toBe(1);
  });

  it("returns 0.0 when none are on the target patch", () => {
    const used = [
      createWindowedParticipant({ gameVersion: "16.11.1.1" }),
      createWindowedParticipant({ gameVersion: "16.10.1.1" }),
    ];
    expect(computeFreshShare(used, "16.12")).toBe(0);
  });

  it("returns the correct fraction for a mixed set", () => {
    const used = [
      createWindowedParticipant({ gameVersion: "16.12.1.1" }),
      createWindowedParticipant({ gameVersion: "16.12.9.9" }),
      createWindowedParticipant({ gameVersion: "16.11.1.1" }),
      createWindowedParticipant({ gameVersion: "16.10.1.1" }),
    ];
    expect(computeFreshShare(used, "16.12")).toBeCloseTo(0.5, 10);
  });

  it("matches on the first two version segments only", () => {
    const used = [createWindowedParticipant({ gameVersion: "16.12.123.456" })];
    expect(computeFreshShare(used, "16.12")).toBe(1);
  });

  it("returns 0 for an empty set", () => {
    expect(computeFreshShare([], "16.12")).toBe(0);
  });
});

describe("aggregateBuilds", () => {
  // Build a champion that has K participants spread so backfill is exercised:
  // few in the 7d window, enough by 14d. Items identical so they cluster.
  function freshMatchesForChampion(
    championId: number,
    championName: string
  ): MatchData[] {
    const matches: MatchData[] = [];
    // 5 fresh (within 7d) on the target patch, all winners with the same build.
    for (let i = 0; i < 5; i++) {
      matches.push(
        createMatch({
          matchId: `${championName}-fresh-${i}`,
          gameVersion: "16.12.10.10",
          gameEndTimestamp: daysAgoMs(2),
          participants: [
            createParticipant({
              puuid: `${championName}-p-fresh-${i}`,
              championId,
              championName,
              win: true,
              items: [3031, 6672, 3094, 3036, 3072, 3026, 3340],
            }),
          ],
        })
      );
    }
    // 40 more within 14d on an OLDER patch, same build, mix of wins so the
    // cluster survives the 0.45 win-rate filter.
    for (let i = 0; i < 40; i++) {
      matches.push(
        createMatch({
          matchId: `${championName}-back-${i}`,
          gameVersion: "16.11.5.5",
          gameEndTimestamp: daysAgoMs(11),
          participants: [
            createParticipant({
              puuid: `${championName}-p-back-${i}`,
              championId,
              championName,
              win: i % 2 === 0,
              items: [3031, 6672, 3094, 3036, 3072, 3026, 3340],
            }),
          ],
        })
      );
    }
    return matches;
  }

  it("produces per-champion builds via date-window backfill with freshness metrics", () => {
    const matches = freshMatchesForChampion(222, "Jinx");
    const output = aggregateBuilds(
      matches,
      ARAM_QUEUE,
      ["16.12", "16.11"],
      NOW_MS
    );

    expect(output.targetPatch).toBe("16.12");
    expect(output.patch).toBe("16.12");
    expect(output.queueId).toBe(450);
    expect(output.queueName).toBe("ARAM");

    const jinx = output.champions["222"];
    expect(jinx).toBeDefined();
    expect(jinx.championName).toBe("Jinx");
    // 5 fresh at 7d is below K=40, so it backfills to 14d: 45 participants.
    expect(jinx.windowDaysUsed).toBe(14);
    expect(jinx.sampleSize).toBe(45);
    // 5 of 45 used participants are on the target patch.
    expect(jinx.freshPatchShare).toBeCloseTo(5 / 45, 10);
    // Identical items cluster into one surviving build.
    expect(jinx.builds.length).toBe(1);
    expect(jinx.builds[0].games).toBe(45);
    // Every used participant builds the same six items, so each sits at 100%
    // presence; the pool is those six, ordered by presence then item id.
    expect(jinx.itemPool.map((e) => e.itemId)).toEqual([
      3026, 3031, 3036, 3072, 3094, 6672,
    ]);
    expect(jinx.itemPool.every((e) => e.presence === 1)).toBe(true);
  });

  it("sets overall freshPatchShare across all used participants", () => {
    const matches = freshMatchesForChampion(222, "Jinx");
    const output = aggregateBuilds(
      matches,
      ARAM_QUEUE,
      ["16.12", "16.11"],
      NOW_MS
    );
    // All used participants belong to Jinx: 5 of 45 are fresh.
    expect(output.freshPatchShare).toBeCloseTo(5 / 45, 10);
  });

  it("uses only the 7d window for a champion that has >=K fresh participants", () => {
    const matches: MatchData[] = [];
    // 40 fresh winners within 7d, plus extra older ones that must be ignored.
    for (let i = 0; i < CHAMPION_PARTICIPANT_TARGET; i++) {
      matches.push(
        createMatch({
          matchId: `fresh-${i}`,
          gameVersion: "16.12.10.10",
          gameEndTimestamp: daysAgoMs(3),
          participants: [
            createParticipant({
              puuid: `p-fresh-${i}`,
              championId: 99,
              championName: "Lux",
              win: i % 3 !== 0,
            }),
          ],
        })
      );
    }
    for (let i = 0; i < 20; i++) {
      matches.push(
        createMatch({
          matchId: `old-${i}`,
          gameVersion: "16.10.1.1",
          gameEndTimestamp: daysAgoMs(40),
          participants: [
            createParticipant({
              puuid: `p-old-${i}`,
              championId: 99,
              championName: "Lux",
            }),
          ],
        })
      );
    }

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const lux = output.champions["99"];
    expect(lux.windowDaysUsed).toBe(7);
    expect(lux.sampleSize).toBe(CHAMPION_PARTICIPANT_TARGET);
    expect(lux.freshPatchShare).toBe(1);
  });

  it("gates BUILDS by the >=2-games/>=0.45-winrate filters but still emits the item pool", () => {
    const matches: MatchData[] = [];
    // Annie: a single game with a valid six-item set. The build cluster fails
    // the >=2-games filter (so `builds` is empty), but item PRESENCE still
    // yields a pool, so the champion is emitted. The pool is never gated by the
    // build threshold. She carries no spells, proving the pool alone keeps her.
    matches.push(
      createMatch({
        matchId: "solo",
        gameVersion: "16.12.1.1",
        gameEndTimestamp: daysAgoMs(2),
        participants: [
          createParticipant({
            puuid: "solo-p",
            championId: 1,
            championName: "Annie",
            win: true,
            summonerSpells: [],
          }),
        ],
      })
    );
    // Olaf: the only participant has <3 completed items (remake), excluded
    // before grouping, so the champion has no games at all and is dropped.
    matches.push(
      createMatch({
        matchId: "remake",
        gameVersion: "16.12.1.1",
        gameEndTimestamp: daysAgoMs(2),
        participants: [
          createParticipant({
            puuid: "remake-p",
            championId: 2,
            championName: "Olaf",
            win: true,
            items: [3031, 0, 0, 0, 0, 0, 3340],
          }),
        ],
      })
    );

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    // Annie: build filtered out, but emitted with a presence-sourced item pool.
    const annie = output.champions["1"];
    expect(annie).toBeDefined();
    expect(annie.builds).toEqual([]);
    expect(annie.itemPool.length).toBeGreaterThan(0);
    // Olaf: no qualifying participant, dropped entirely.
    expect(output.champions["2"]).toBeUndefined();
  });

  it("sources the item pool from presence with a floor, ordered by presence then item id", () => {
    // 20 participants for one champion. Item 1000 is in every game (100%), 2000
    // in 6 (30%), 3000 in 2 (10%, exactly the floor, kept), 4000 in 1 (5%,
    // dropped). Each participant also carries unique filler items (5% each,
    // dropped) so every participant clears the >=3-completed-items grouping gate.
    const matches: MatchData[] = [];
    for (let i = 0; i < 20; i++) {
      let extra: number;
      if (i < 6) extra = 2000;
      else if (i < 8) extra = 3000;
      else if (i < 9) extra = 4000;
      else extra = 5000 + i;
      matches.push(
        createMatch({
          matchId: `pool-${i}`,
          gameVersion: "16.12.1.1",
          gameEndTimestamp: daysAgoMs(2),
          participants: [
            createParticipant({
              puuid: `pool-p-${i}`,
              championId: 300,
              championName: "Ahri",
              win: i % 2 === 0,
              items: [1000, extra, 9000 + i, 9500 + i, 0, 0, 3340],
            }),
          ],
        })
      );
    }

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const ahri = output.champions["300"];
    expect(ahri.itemPool.map((e) => e.itemId)).toEqual([1000, 2000, 3000]);
    expect(ahri.itemPool[0].presence).toBeCloseTo(1.0, 10);
    expect(ahri.itemPool[1].presence).toBeCloseTo(0.3, 10);
    expect(ahri.itemPool[2].presence).toBeCloseTo(ITEM_POOL_PRESENCE_FLOOR, 10);
    // Below-floor items (4000 at 5%, every filler at 5%) are excluded.
    expect(ahri.itemPool.some((e) => e.itemId === 4000)).toBe(false);
  });

  it("caps the item pool at ITEM_POOL_MAX_SIZE when many items clear the floor", () => {
    // 10 participants, each building 6 unique items, so 60 distinct items each
    // appear in exactly 1/10 games (10%, at the floor). All clear the floor, so
    // only the cap bounds the pool; ties on presence break by item id ascending,
    // so the 30 lowest ids survive.
    const matches: MatchData[] = [];
    for (let i = 0; i < 10; i++) {
      const base = 1000 + i * 6;
      matches.push(
        createMatch({
          matchId: `cap-${i}`,
          gameVersion: "16.12.1.1",
          gameEndTimestamp: daysAgoMs(2),
          participants: [
            createParticipant({
              puuid: `cap-p-${i}`,
              championId: 301,
              championName: "Sona",
              win: i % 2 === 0,
              items: [
                base,
                base + 1,
                base + 2,
                base + 3,
                base + 4,
                base + 5,
                3340,
              ],
            }),
          ],
        })
      );
    }

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const sona = output.champions["301"];
    expect(sona.itemPool.length).toBe(ITEM_POOL_MAX_SIZE);
    expect(sona.itemPool[0].itemId).toBe(1000);
    expect(sona.itemPool[ITEM_POOL_MAX_SIZE - 1].itemId).toBe(
      1000 + ITEM_POOL_MAX_SIZE - 1
    );
    expect(
      sona.itemPool.some((e) => e.itemId === 1000 + ITEM_POOL_MAX_SIZE)
    ).toBe(false);
  });

  it("keeps a champion with spell data even when no item build clusters", () => {
    // Two games, each a distinct one-off item set, so every build cluster has
    // only 1 game and is filtered out (no surviving builds). Both carry the same
    // spell pair. The champion must still appear, with empty builds and its
    // popularSpells, so the summoner-spell recommendation is never gated by the
    // item-build threshold.
    const items1 = [1001, 1002, 1003, 1004, 0, 0, 3340];
    const items2 = [2001, 2002, 2003, 2004, 0, 0, 3340];
    const matches: MatchData[] = [items1, items2].map((items, i) =>
      createMatch({
        matchId: `nobuild-${i}`,
        gameVersion: "16.12.1.1",
        gameEndTimestamp: daysAgoMs(2),
        participants: [
          createParticipant({
            puuid: `nobuild-p-${i}`,
            championId: 77,
            championName: "Udyr",
            win: true,
            items,
            summonerSpells: [4, 32],
          }),
        ],
      })
    );

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const udyr = output.champions["77"];
    expect(udyr).toBeDefined();
    expect(udyr.builds).toEqual([]);
    // Each one-off set contributes four items at 50% presence, so the pool holds
    // all eight even though no exact-set build cluster survives.
    expect(udyr.itemPool.length).toBe(8);
    expect(udyr.itemPool.every((e) => e.presence === 0.5)).toBe(true);
    expect(udyr.popularSpells).toBeDefined();
    expect(udyr.popularSpells![0].spells).toEqual([4, 32]);
    expect(udyr.popularSpells![0].picks).toBe(2);
  });

  it("aggregates popularAugments when participants carry augments", () => {
    const matches: MatchData[] = [];
    for (let i = 0; i < 4; i++) {
      matches.push(
        createMatch({
          matchId: `aug-${i}`,
          gameVersion: "16.12.1.1",
          gameEndTimestamp: daysAgoMs(2),
          participants: [
            createParticipant({
              puuid: `aug-p-${i}`,
              championId: 555,
              championName: "Pyke",
              win: i % 2 === 0,
              augments: [101, 202],
            }),
          ],
        })
      );
    }

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const pyke = output.champions["555"];
    expect(pyke).toBeDefined();
    expect(pyke.popularAugments).toBeDefined();
    const aug101 = pyke.popularAugments?.find((a) => a.augmentId === 101);
    expect(aug101?.picks).toBe(4);
  });

  it("aggregates popularSpells as normalized pairs ordered by picks", () => {
    const spellsByIndex = [
      [4, 6], // win
      [6, 4], // loss: same pair, reversed order, must cluster with [4,6]
      [4, 7], // win: a different pair
      [4, 6], // win
    ];
    const matches: MatchData[] = spellsByIndex.map((spells, i) =>
      createMatch({
        matchId: `spell-${i}`,
        gameVersion: "16.12.1.1",
        gameEndTimestamp: daysAgoMs(2),
        participants: [
          createParticipant({
            puuid: `spell-p-${i}`,
            championId: 555,
            championName: "Pyke",
            win: i !== 1,
            summonerSpells: spells,
          }),
        ],
      })
    );

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const pyke = output.champions["555"];
    expect(pyke.popularSpells).toBeDefined();

    // [4,6] appears 3x (including the reversed [6,4]); [4,7] once. Most-picked
    // first, with the pair normalized ascending.
    const [top, second] = pyke.popularSpells!;
    expect(top.spells).toEqual([4, 6]);
    expect(top.picks).toBe(3);
    expect(top.wins).toBe(2); // the reversed [6,4] entry was the loss
    expect(top.pickRate).toBeCloseTo(3 / 4, 10);
    expect(top.winRate).toBeCloseTo(2 / 3, 10);
    expect(second.spells).toEqual([4, 7]);
    expect(second.picks).toBe(1);
  });

  it("omits popularSpells when no participant carries a complete spell pair", () => {
    // Simulate matches cached before the field existed: the participant object
    // has no summonerSpells key at all. Aggregation must not crash and must
    // leave popularSpells off the champion.
    const matches: MatchData[] = [];
    for (let i = 0; i < 3; i++) {
      const participant = createParticipant({
        puuid: `legacy-p-${i}`,
        championId: 777,
        championName: "Ashe",
        win: i % 2 === 0,
      });
      delete (participant as Partial<ParticipantData>).summonerSpells;
      matches.push(
        createMatch({
          matchId: `legacy-${i}`,
          gameVersion: "16.12.1.1",
          gameEndTimestamp: daysAgoMs(2),
          participants: [participant],
        })
      );
    }

    const output = aggregateBuilds(matches, ARAM_QUEUE, ["16.12"], NOW_MS);
    const ashe = output.champions["777"];
    expect(ashe).toBeDefined();
    expect(ashe.popularSpells).toBeUndefined();
  });
});
