import { describe, it, expect } from "vitest";
import { recentGames, windowStats } from "./aggregate";
import type { MatchSummary } from "./types";

const NOW = 1_700_000_000_000; // ~2023-11-14 UTC
const DAY = 24 * 60 * 60 * 1000;

function match(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    gameId: "G1",
    championName: "Lux",
    championId: 99,
    gameMode: "ARAM",
    queueId: 450,
    result: "win",
    kills: 10,
    deaths: 5,
    assists: 15,
    largestKillingSpree: 2,
    finalItems: [],
    durationSeconds: 1500,
    gameCreation: NOW - 1 * DAY,
    ...overrides,
  };
}

describe("windowStats", () => {
  it("empty input → zero stats", () => {
    const s = windowStats([], { days: 7, now: NOW });
    expect(s).toEqual({
      totalGames: 0,
      wins: 0,
      losses: 0,
      avgKDA: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
    });
  });

  it("counts wins and losses inside the window", () => {
    const matches = [
      match({ gameId: "G1", result: "win", gameCreation: NOW - 1 * DAY }),
      match({ gameId: "G2", result: "loss", gameCreation: NOW - 2 * DAY }),
      match({ gameId: "G3", result: "win", gameCreation: NOW - 3 * DAY }),
    ];
    const s = windowStats(matches, { days: 7, now: NOW });
    expect(s.totalGames).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
  });

  it("excludes remade games from totals, win/loss counts, and KDA", () => {
    const matches = [
      match({
        gameId: "W",
        result: "win",
        kills: 10,
        deaths: 5,
        assists: 5,
        gameCreation: NOW - 1 * DAY,
      }),
      match({
        gameId: "R",
        result: "remake",
        kills: 7,
        deaths: 2,
        assists: 3,
        gameCreation: NOW - 2 * DAY,
      }),
    ];
    const s = windowStats(matches, { days: 7, now: NOW });
    expect(s.totalGames).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(0);
    expect(s.totalKills).toBe(10);
    expect(s.avgKDA).toBeCloseTo(3); // (10+5)/5, the remake not averaged in
  });

  it("returns zero stats when the window contains only remakes", () => {
    const s = windowStats(
      [match({ result: "remake", gameCreation: NOW - 1 * DAY })],
      { days: 7, now: NOW }
    );
    expect(s).toEqual({
      totalGames: 0,
      wins: 0,
      losses: 0,
      avgKDA: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
    });
  });

  it("ignores matches outside the day window", () => {
    const matches = [
      match({ gameId: "G1", gameCreation: NOW - 1 * DAY }),
      match({ gameId: "G2", gameCreation: NOW - 30 * DAY }),
    ];
    const s = windowStats(matches, { days: 7, now: NOW });
    expect(s.totalGames).toBe(1);
  });

  it("avgKDA = mean across matches, deaths floored to 1", () => {
    const matches = [
      match({ kills: 10, deaths: 5, assists: 5, gameCreation: NOW - 1 * DAY }), // (10+5)/5 = 3
      match({ kills: 10, deaths: 0, assists: 0, gameCreation: NOW - 2 * DAY }), // (10+0)/1 = 10
    ];
    const s = windowStats(matches, { days: 7, now: NOW });
    // mean of [3, 10] = 6.5
    expect(s.avgKDA).toBeCloseTo(6.5);
  });

  it("sums total kills/deaths/assists", () => {
    const matches = [
      match({ kills: 5, deaths: 2, assists: 7, gameCreation: NOW - 1 * DAY }),
      match({ kills: 3, deaths: 4, assists: 1, gameCreation: NOW - 2 * DAY }),
    ];
    const s = windowStats(matches, { days: 7, now: NOW });
    expect(s.totalKills).toBe(8);
    expect(s.totalDeaths).toBe(6);
    expect(s.totalAssists).toBe(8);
  });

  it("days defaults to 7 when omitted", () => {
    const matches = [
      match({ gameId: "G1", gameCreation: NOW - 6 * DAY }),
      match({ gameId: "G2", gameCreation: NOW - 8 * DAY }),
    ];
    const s = windowStats(matches, { now: NOW });
    expect(s.totalGames).toBe(1);
  });

  it("handles zero-deaths game without divide-by-zero", () => {
    const matches = [
      match({ kills: 5, deaths: 0, assists: 5, gameCreation: NOW - 1 * DAY }),
    ];
    const s = windowStats(matches, { days: 7, now: NOW });
    expect(s.avgKDA).toBe(10); // (5+5)/max(0,1) = 10
    expect(Number.isFinite(s.avgKDA)).toBe(true);
  });
});

describe("recentGames", () => {
  it("returns empty for empty input", () => {
    expect(recentGames([], 5)).toEqual([]);
  });

  it("returns the n most recent matches in reverse-chronological order", () => {
    const matches = [
      match({ gameId: "Old", gameCreation: NOW - 30 * DAY }),
      match({ gameId: "Mid", gameCreation: NOW - 5 * DAY }),
      match({ gameId: "Newest", gameCreation: NOW - 1 * DAY }),
    ];
    const result = recentGames(matches, 5);
    expect(result.map((m) => m.gameId)).toEqual(["Newest", "Mid", "Old"]);
  });

  it("caps at n", () => {
    const matches = [
      match({ gameId: "G1", gameCreation: NOW - 1 * DAY }),
      match({ gameId: "G2", gameCreation: NOW - 2 * DAY }),
      match({ gameId: "G3", gameCreation: NOW - 3 * DAY }),
    ];
    expect(recentGames(matches, 2)).toHaveLength(2);
    expect(recentGames(matches, 2).map((m) => m.gameId)).toEqual(["G1", "G2"]);
  });

  it("returns empty when n is 0 or negative", () => {
    const matches = [match()];
    expect(recentGames(matches, 0)).toEqual([]);
    expect(recentGames(matches, -1)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const matches = [
      match({ gameId: "G1", gameCreation: NOW - 5 * DAY }),
      match({ gameId: "G2", gameCreation: NOW - 1 * DAY }),
    ];
    const originalOrder = matches.map((m) => m.gameId);
    recentGames(matches, 5);
    expect(matches.map((m) => m.gameId)).toEqual(originalOrder);
  });
});
