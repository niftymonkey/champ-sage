import { describe, it, expect } from "vitest";
import {
  tallyChampionGames,
  buildReadinessReport,
  formatReadinessLine,
  formatReadinessReport,
  type ChampionGameCount,
} from "./readiness";
import type { MatchData as AggMatchData, ParticipantData } from "./aggregation";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 5, 16);

function daysAgoMs(days: number): number {
  return NOW_MS - days * MS_PER_DAY;
}

function participant(
  championId: number,
  championName: string
): ParticipantData {
  return {
    puuid: `p-${championId}-${Math.floor(NOW_MS)}`,
    championId,
    championName,
    win: true,
    items: [3031, 6672, 3094, 0, 0, 0, 3340],
    perks: {
      statPerks: { defense: 0, flex: 0, offense: 0 },
      styles: [],
    },
    teamPosition: "",
    augments: [],
    summonerSpells: [4, 6],
  };
}

function match(
  gameEndTimestamp: number,
  participants: ParticipantData[]
): AggMatchData {
  return {
    matchId: `m-${gameEndTimestamp}-${participants.length}`,
    queueId: 450,
    gameVersion: "16.12.1.1",
    gameDuration: 1500,
    gameEndTimestamp,
    participants,
  };
}

function count(
  championId: number,
  championName: string,
  games: number
): ChampionGameCount {
  return { championId, championName, games };
}

describe("tallyChampionGames", () => {
  it("counts one game per participant appearance, per champion", () => {
    const matches: AggMatchData[] = [
      match(daysAgoMs(1), [
        participant(1, "Annie"),
        participant(1, "Annie"),
        participant(2, "Olaf"),
      ]),
      match(daysAgoMs(2), [participant(1, "Annie")]),
    ];
    const counts = tallyChampionGames(matches, daysAgoMs(30));
    const annie = counts.find((c) => c.championId === 1);
    const olaf = counts.find((c) => c.championId === 2);
    expect(annie?.games).toBe(3);
    expect(olaf?.games).toBe(1);
  });

  it("excludes matches older than the cutoff", () => {
    const matches: AggMatchData[] = [
      match(daysAgoMs(2), [participant(1, "Annie")]),
      match(daysAgoMs(40), [participant(1, "Annie"), participant(2, "Olaf")]),
    ];
    const counts = tallyChampionGames(matches, daysAgoMs(30));
    expect(counts.find((c) => c.championId === 1)?.games).toBe(1);
    // Olaf appears only in the out-of-window match, so he is absent entirely.
    expect(counts.find((c) => c.championId === 2)).toBeUndefined();
  });
});

describe("buildReadinessReport", () => {
  it("counts champions at or above the target and flags the rest", () => {
    const report = buildReadinessReport(
      [count(1, "Annie", 250), count(2, "Olaf", 200), count(3, "RekSai", 118)],
      200
    );
    expect(report.totalChampions).toBe(3);
    expect(report.readyCount).toBe(2);
    expect(report.allReady).toBe(false);
  });

  it("reports allReady only when every seen champion meets the target", () => {
    const report = buildReadinessReport(
      [count(1, "Annie", 250), count(2, "Olaf", 200)],
      200
    );
    expect(report.allReady).toBe(true);
  });

  it("is not allReady for an empty set", () => {
    const report = buildReadinessReport([], 200);
    expect(report.totalChampions).toBe(0);
    expect(report.allReady).toBe(false);
    expect(report.rarest).toBeNull();
  });

  it("identifies the rarest champion", () => {
    const report = buildReadinessReport(
      [count(1, "Annie", 250), count(3, "RekSai", 55), count(2, "Olaf", 120)],
      200
    );
    expect(report.rarest?.championName).toBe("RekSai");
    expect(report.rarest?.games).toBe(55);
  });

  it("lists laggards ascending by games then champion id", () => {
    const report = buildReadinessReport(
      [
        count(1, "Annie", 250), // ready, excluded from laggards
        count(5, "Yuumi", 120),
        count(3, "RekSai", 55),
        count(4, "Briar", 120),
      ],
      200
    );
    expect(report.laggards.map((c) => c.championName)).toEqual([
      "RekSai", // 55
      "Briar", // 120, lower id than Yuumi
      "Yuumi", // 120
    ]);
  });
});

describe("formatReadinessLine", () => {
  it("summarizes ready count, total, target, and rarest", () => {
    const report = buildReadinessReport(
      [count(1, "Annie", 250), count(3, "RekSai", 118)],
      200
    );
    const line = formatReadinessLine(report);
    expect(line).toContain("1/2");
    expect(line).toContain(">=200");
    expect(line).toContain("RekSai");
    expect(line).toContain("118");
  });
});

describe("formatReadinessReport", () => {
  it("names laggards with their game counts", () => {
    const report = buildReadinessReport(
      [count(1, "Annie", 250), count(3, "RekSai", 55)],
      200
    );
    const lines = formatReadinessReport(report);
    const joined = lines.join("\n");
    expect(joined).toContain("1/2");
    expect(joined).toContain("RekSai");
    expect(joined).toContain("55");
  });

  it("reports completion when all champions reached the target", () => {
    const report = buildReadinessReport([count(1, "Annie", 250)], 200);
    const joined = formatReadinessReport(report).join("\n");
    expect(joined.toLowerCase()).toContain("all");
  });

  it("truncates a long laggard list and notes the remainder", () => {
    const many: ChampionGameCount[] = [];
    for (let i = 0; i < 25; i++) many.push(count(i + 1, `Champ${i}`, 10));
    const report = buildReadinessReport(many, 200);
    const joined = formatReadinessReport(report, 20).join("\n");
    expect(joined).toContain("5 more");
  });
});
