import { describe, it, expect } from "vitest";
import { lcuMatchToSummary, type ChampionNameResolver } from "./parse";

const championMap = new Map<number, string>([
  [99, "Lux"],
  [22, "Ashe"],
  [266, "Aatrox"],
]);

const resolver: ChampionNameResolver = (id) => championMap.get(id) ?? null;

const fullPayload = {
  gameId: 5554483510,
  gameMode: "ARAM",
  queueId: 450,
  gameDuration: 1634,
  gameCreation: 1_700_000_000_000,
  participants: [
    {
      championId: 99,
      stats: {
        win: true,
        kills: 12,
        deaths: 4,
        assists: 18,
      },
    },
  ],
};

describe("lcuMatchToSummary", () => {
  it("parses a complete payload", () => {
    const m = lcuMatchToSummary(fullPayload, resolver);
    expect(m).not.toBeNull();
    expect(m?.gameId).toBe("5554483510");
    expect(m?.championName).toBe("Lux");
    expect(m?.championId).toBe(99);
    expect(m?.gameMode).toBe("ARAM");
    expect(m?.queueId).toBe(450);
    expect(m?.isWin).toBe(true);
    expect(m?.kills).toBe(12);
    expect(m?.deaths).toBe(4);
    expect(m?.assists).toBe(18);
    expect(m?.durationSeconds).toBe(1634);
    expect(m?.gameCreation).toBe(1_700_000_000_000);
  });

  it("returns null when required fields are missing", () => {
    expect(lcuMatchToSummary({}, resolver)).toBeNull();
    expect(
      lcuMatchToSummary({ ...fullPayload, gameId: undefined }, resolver)
    ).toBeNull();
    expect(
      lcuMatchToSummary({ ...fullPayload, participants: [] }, resolver)
    ).toBeNull();
  });

  it("returns null when raw is not an object", () => {
    expect(lcuMatchToSummary(null, resolver)).toBeNull();
    expect(lcuMatchToSummary("not an object", resolver)).toBeNull();
    expect(lcuMatchToSummary(42, resolver)).toBeNull();
  });

  it("falls back to numeric champion label when resolver returns null", () => {
    const m = lcuMatchToSummary(
      {
        ...fullPayload,
        participants: [{ ...fullPayload.participants[0], championId: 9999 }],
      },
      resolver
    );
    expect(m?.championName).toBe("Champion 9999");
  });

  it("derives gameMode from queueId when raw gameMode is missing", () => {
    const m = lcuMatchToSummary(
      { ...fullPayload, gameMode: undefined, queueId: 450 },
      resolver
    );
    expect(m?.gameMode).toBe("ARAM");
  });

  it("normalizes CHERRY mode by string and by queueId", () => {
    expect(
      lcuMatchToSummary({ ...fullPayload, gameMode: "CHERRY" }, resolver)
        ?.gameMode
    ).toBe("CHERRY");
    expect(
      lcuMatchToSummary(
        { ...fullPayload, gameMode: undefined, queueId: 1700 },
        resolver
      )?.gameMode
    ).toBe("CHERRY");
  });

  it("maps LCU KIWI gameMode to MAYHEM", () => {
    const m = lcuMatchToSummary({ ...fullPayload, gameMode: "KIWI" }, resolver);
    expect(m?.gameMode).toBe("MAYHEM");
  });

  it("normalizes unrecognized modes to OTHER", () => {
    const m = lcuMatchToSummary(
      { ...fullPayload, gameMode: "URF", queueId: 76 },
      resolver
    );
    expect(m?.gameMode).toBe("OTHER");
  });

  it("treats missing stats fields as zero", () => {
    const m = lcuMatchToSummary(
      {
        ...fullPayload,
        participants: [{ championId: 99, stats: { win: false } }],
      },
      resolver
    );
    expect(m?.kills).toBe(0);
    expect(m?.deaths).toBe(0);
    expect(m?.assists).toBe(0);
    expect(m?.isWin).toBe(false);
  });

  it("handles numeric gameId by stringifying it", () => {
    const m = lcuMatchToSummary({ ...fullPayload, gameId: 1234 }, resolver);
    expect(m?.gameId).toBe("1234");
  });
});
