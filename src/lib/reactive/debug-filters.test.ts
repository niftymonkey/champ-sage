import { describe, it, expect } from "vitest";
import {
  isDebugWorthy,
  shouldLogPollStatus,
  describeEvent,
} from "./debug-filters";

describe("isDebugWorthy", () => {
  it("allows gameflow phase events", () => {
    expect(isDebugWorthy("/lol-gameflow/v1/gameflow-phase")).toBe(true);
  });

  it("allows gameflow session events", () => {
    expect(isDebugWorthy("/lol-gameflow/v1/session")).toBe(true);
  });

  it("allows champ select session events", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/session")).toBe(true);
  });

  it("filters out grid-champions noise", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/grid-champions/143")).toBe(
      false
    );
  });

  it("filters out skin-carousel noise", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/skin-carousel-skins")).toBe(
      false
    );
  });

  it("filters out matchmaking search ticks", () => {
    expect(isDebugWorthy("/lol-matchmaking/v1/search")).toBe(false);
  });

  it("filters out settings updates", () => {
    expect(isDebugWorthy("/lol-settings/v1/account/champ-select")).toBe(false);
  });

  it("filters out hovercard updates", () => {
    expect(isDebugWorthy("/lol-hovercard/v1/friend-info/some-uuid")).toBe(
      false
    );
  });

  it("filters out lobby-team-builder noise", () => {
    expect(
      isDebugWorthy(
        "/lol-lobby-team-builder/champ-select/v1/pickable-champion-ids"
      )
    ).toBe(false);
  });

  it("filters out summoner individual updates", () => {
    expect(isDebugWorthy("/lol-champ-select/v1/summoners/3")).toBe(false);
  });
});

describe("describeEvent", () => {
  it("describes gameflow phase updates", () => {
    expect(
      describeEvent("Update", "/lol-gameflow/v1/gameflow-phase")
    ).toContain("Gameflow phase");
  });

  it("describes game session updates", () => {
    expect(describeEvent("Update", "/lol-gameflow/v1/session")).toContain(
      "Game session"
    );
  });

  it("describes champ select ending", () => {
    expect(describeEvent("Delete", "/lol-champ-select/v1/session")).toBe(
      "Champion Select ended"
    );
  });

  it("describes champ select updates", () => {
    expect(describeEvent("Update", "/lol-champ-select/v1/session")).toBe(
      "Champion Select updated"
    );
  });

  it("describes league session token", () => {
    expect(
      describeEvent("Update", "/lol-league-session/v1/league-session-token")
    ).toContain("League session token");
  });

  it("falls back to raw event for unknown URIs", () => {
    expect(describeEvent("Update", "/unknown/path")).toBe(
      "Update /unknown/path"
    );
  });
});

describe("shouldLogPollStatus", () => {
  it("logs the first status", () => {
    expect(shouldLogPollStatus("LOADING", null)).toBe(true);
  });

  it("suppresses repeated LOADING status", () => {
    expect(shouldLogPollStatus("LOADING", "LOADING")).toBe(false);
  });

  it("logs when status changes from LOADING to OK", () => {
    expect(shouldLogPollStatus("OK", "LOADING")).toBe(true);
  });

  it("logs when status changes from OK to LOADING", () => {
    expect(shouldLogPollStatus("LOADING", "OK")).toBe(true);
  });

  it("suppresses repeated OK status", () => {
    expect(shouldLogPollStatus("OK", "OK")).toBe(false);
  });

  it("logs when status changes from CONNECTION_FAILED to LOADING", () => {
    expect(shouldLogPollStatus("LOADING", "CONNECTION_FAILED")).toBe(true);
  });
});
