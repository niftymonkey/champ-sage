import { describe, it, expect } from "vitest";
import {
  resolveSummonerSpellName,
  summonerSpellIconUrl,
} from "./summoner-spells";

describe("resolveSummonerSpellName", () => {
  it("names the standard Summoner's Rift spells", () => {
    expect(resolveSummonerSpellName(4)).toBe("Flash");
    expect(resolveSummonerSpellName(6)).toBe("Ghost");
    expect(resolveSummonerSpellName(7)).toBe("Heal");
    expect(resolveSummonerSpellName(14)).toBe("Ignite");
  });

  it("names ARAM-eligible spells that show up in the meta data", () => {
    // Real aram.new.json pairs include 32 (Mark), 21 (Barrier), 3 (Exhaust),
    // 13 (Clarity); all must resolve, not just the SR core kit.
    expect(resolveSummonerSpellName(32)).toBe("Mark");
    expect(resolveSummonerSpellName(21)).toBe("Barrier");
    expect(resolveSummonerSpellName(3)).toBe("Exhaust");
    expect(resolveSummonerSpellName(13)).toBe("Clarity");
  });

  it("falls back to a stable label for an unknown ID", () => {
    expect(resolveSummonerSpellName(999)).toBe("Spell 999");
  });
});

describe("summonerSpellIconUrl", () => {
  it("builds the Data Dragon spell icon URL at the given version", () => {
    expect(summonerSpellIconUrl(4, "16.13.1")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/SummonerFlash.png"
    );
    expect(summonerSpellIconUrl(32, "16.13.1")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/spell/SummonerSnowball.png"
    );
  });

  it("returns an empty string for an unknown ID so callers can fall back", () => {
    expect(summonerSpellIconUrl(999, "16.13.1")).toBe("");
  });
});
