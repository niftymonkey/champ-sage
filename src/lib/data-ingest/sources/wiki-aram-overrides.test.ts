import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAramOverrides } from "./wiki-aram-overrides";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const SAMPLE_LUA = `-- <pre>
return {
  ["Aatrox"] = {
    ["id"] = 266,
    ["apiname"] = "Aatrox",
    ["stats"] = {
      ["hp_base"] = 650,
      ["aram"] = {
        ["dmg_dealt"] = 1.05,
        ["dmg_taken"] = 1,
      },
    },
  },
  ["Ahri"] = {
    ["id"] = 103,
    ["apiname"] = "Ahri",
    ["stats"] = {
      ["hp_base"] = 590,
      ["aram"] = {
        ["dmg_dealt"] = 1,
        ["dmg_taken"] = 1,
        ["healing"] = 0.9,
      },
    },
  },
  ["Akali"] = {
    ["id"] = 84,
    ["apiname"] = "Akali",
    ["stats"] = {
      ["hp_base"] = 600,
      ["aram"] = {
        ["dmg_dealt"] = 1,
        ["dmg_taken"] = 0.95,
        ["energyregen_mod"] = 1.2,
        ["tenacity"] = 1.2,
      },
    },
  },
  ["Garen"] = {
    ["id"] = 86,
    ["apiname"] = "Garen",
    ["stats"] = {
      ["hp_base"] = 690,
    },
  },
}`;

function textResponse(text: string) {
  return { ok: true, text: () => Promise.resolve(text) };
}

describe("fetchAramOverrides", () => {
  it("extracts ARAM overrides keyed by lowercase champion name", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    expect(overrides.size).toBe(3);
    expect(overrides.has("aatrox")).toBe(true);
    expect(overrides.has("ahri")).toBe(true);
    expect(overrides.has("akali")).toBe(true);
  });

  it("skips champions without ARAM overrides", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    expect(overrides.has("garen")).toBe(false);
  });

  it("parses damage dealt/taken multipliers", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    const aatrox = overrides.get("aatrox")!;
    expect(aatrox.dmgDealt).toBe(1.05);
    expect(aatrox.dmgTaken).toBe(1);
  });

  it("parses healing modifier", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    const ahri = overrides.get("ahri")!;
    expect(ahri.healing).toBe(0.9);
  });

  it("parses energy regen and tenacity modifiers", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    const akali = overrides.get("akali")!;
    expect(akali.energyRegenMod).toBe(1.2);
    expect(akali.tenacity).toBe(1.2);
  });

  it("omits optional fields when not present", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    const aatrox = overrides.get("aatrox")!;
    expect(aatrox.healing).toBeUndefined();
    expect(aatrox.shielding).toBeUndefined();
    expect(aatrox.tenacity).toBeUndefined();
  });

  it("returns champion name as display name, not apiname", async () => {
    mockFetch.mockResolvedValue(textResponse(SAMPLE_LUA));

    const overrides = await fetchAramOverrides();
    // Keys are lowercase versions of the Lua table keys (display names)
    expect(overrides.has("aatrox")).toBe(true);
    expect(overrides.has("ahri")).toBe(true);
  });
});
