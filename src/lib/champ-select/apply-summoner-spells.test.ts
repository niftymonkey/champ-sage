import { describe, it, expect, vi } from "vitest";
import { applySummonerSpells } from "./apply-summoner-spells";
import type { PlatformBridge } from "../reactive/platform-bridge";

function fakeBridge(): PlatformBridge {
  return {
    discoverLcu: vi.fn(),
    fetchLcu: vi.fn(),
    fetchRiotApi: vi.fn(),
    setSummonerSpells: vi.fn(async () => {}),
    connectLcuWebSocket: vi.fn(),
    listenLcuEvent: vi.fn(() => () => {}),
    listenLcuDisconnect: vi.fn(() => () => {}),
  };
}

describe("applySummonerSpells", () => {
  it("calls the bridge with the current credentials and the spell pair", async () => {
    const bridge = fakeBridge();
    await applySummonerSpells(4, 32, {
      bridge,
      credentials: { port: 5000, token: "secret" },
    });

    expect(bridge.setSummonerSpells).toHaveBeenCalledWith(
      5000,
      "secret",
      4,
      32
    );
  });

  it("throws and never calls the bridge when the LCU is not connected", async () => {
    const bridge = fakeBridge();

    await expect(
      applySummonerSpells(4, 32, { bridge, credentials: null })
    ).rejects.toThrow();

    expect(bridge.setSummonerSpells).not.toHaveBeenCalled();
  });
});
