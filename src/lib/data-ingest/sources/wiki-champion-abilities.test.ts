import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchChampionAbilityScaling,
  describeQuarantineReason,
} from "./wiki-champion-abilities";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

interface PageSpec {
  title: string;
  champion: string;
  slot: string;
  leveling?: string;
}

function makePage(spec: PageSpec) {
  const leveling =
    spec.leveling === undefined ? "" : `\n|leveling     = ${spec.leveling}`;
  return {
    pageid: 1,
    title: spec.title,
    revisions: [
      {
        slots: {
          main: {
            content: `{{{{{1<noinclude>|Ability data</noinclude>}}}|An Ability|{{{2|}}}
|champion     = ${spec.champion}
|skill        = ${spec.slot}${leveling}
|targeting    = Unit`,
          },
        },
      },
    ],
  };
}

/** Queue one API response. Redirect entries map requested to resolved titles. */
function respondWith(
  pages: PageSpec[],
  redirects: Array<{ from: string; to: string }> = []
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: { redirects, pages: pages.map(makePage) },
    }),
  });
}

function requestedUrls(): string[] {
  return mockFetch.mock.calls.map((call) => String(call[0]));
}

describe("fetchChampionAbilityScaling", () => {
  it("keys scaling by lowercased champion name and slot", async () => {
    respondWith(
      [
        {
          title: "Template:Data Ahri/Orb of Deception",
          champion: "Ahri",
          slot: "Q",
          leveling: "{{st|Damage Per Pass|{{ap|35 to 135}} {{as|(+ 50% AP)}}}}",
        },
      ],
      [
        {
          from: "Template:Data Ahri/Q",
          to: "Template:Data Ahri/Orb of Deception",
        },
      ]
    );

    const result = await fetchChampionAbilityScaling(["Ahri"]);

    expect(result.byChampion.get("ahri")?.slots.Q).toEqual([
      { label: "Damage Per Pass", value: "35 to 135 (+ 50% AP)" },
    ]);
  });

  it("requests every spell slot for each champion", async () => {
    respondWith([]);
    await fetchChampionAbilityScaling(["Ahri"]);

    const titles = new URL(requestedUrls()[0]).searchParams.get("titles");
    expect(titles?.split("|")).toEqual([
      "Template:Data Ahri/Q",
      "Template:Data Ahri/W",
      "Template:Data Ahri/E",
      "Template:Data Ahri/R",
    ]);
  });

  it("follows redirects, which the wiki needs to resolve slot aliases", async () => {
    respondWith([]);
    await fetchChampionAbilityScaling(["Ahri"]);
    expect(requestedUrls()[0]).toContain("redirects=1");
  });

  it("sends a User-Agent, without which the wiki API answers 403", async () => {
    respondWith([]);
    await fetchChampionAbilityScaling(["Ahri"]);

    const init = mockFetch.mock.calls[0][1];
    expect(init?.headers?.["User-Agent"]).toBeTruthy();
  });

  it("batches titles so no request exceeds the 50-title API cap", async () => {
    // 13 champions * 4 slots = 52 titles, which must split across two requests.
    const champions = Array.from({ length: 13 }, (_, i) => `Champ${i}`);
    respondWith([]);
    respondWith([]);

    await fetchChampionAbilityScaling(champions);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const url of requestedUrls()) {
      const titles = new URL(url).searchParams.get("titles") ?? "";
      expect(titles.split("|").length).toBeLessThanOrEqual(50);
    }
  });

  it("merges slots from several champions in one batch", async () => {
    respondWith([
      {
        title: "Template:Data Ahri/Q",
        champion: "Ahri",
        slot: "Q",
        leveling: "{{st|Magic Damage|{{ap|35 to 135}}}}",
      },
      {
        title: "Template:Data Nasus/Q",
        champion: "Nasus",
        slot: "Q",
        leveling: "{{st|Bonus Physical Damage|{{ap|40 to 120}}}}",
      },
    ]);

    const result = await fetchChampionAbilityScaling(["Ahri", "Nasus"]);

    expect(result.byChampion.get("ahri")?.slots.Q).toHaveLength(1);
    expect(result.byChampion.get("nasus")?.slots.Q).toEqual([
      { label: "Bonus Physical Damage", value: "40 to 120" },
    ]);
  });

  it("omits a champion whose abilities all lack scaling", async () => {
    respondWith([
      { title: "Template:Data Ahri/W", champion: "Ahri", slot: "W" },
    ]);

    const result = await fetchChampionAbilityScaling(["Ahri"]);

    expect(result.byChampion.has("ahri")).toBe(false);
  });

  it("omits a slot whose every stat quarantined", async () => {
    respondWith([
      {
        title: "Template:Data Yasuo/Q",
        champion: "Yasuo",
        slot: "Q",
        leveling: "{{st|Crit Damage|{{as|{{ccd|Yasuo|crit_base}} AD}}}}",
      },
    ]);

    const result = await fetchChampionAbilityScaling(["Yasuo"]);

    expect(result.byChampion.has("yasuo")).toBe(false);
  });

  it("reports coverage and quarantine diagnostics", async () => {
    respondWith([
      {
        title: "Template:Data Yasuo/Q",
        champion: "Yasuo",
        slot: "Q",
        leveling:
          "{{st|Physical Damage|{{ap|20 to 120}} {{as|(+ 105% AD)}}|Crit Damage|{{as|{{ccd|Yasuo|crit_base}} AD}}}}",
      },
    ]);

    const { diagnostics } = await fetchChampionAbilityScaling(["Yasuo"]);

    expect(diagnostics.abilitiesRequested).toBe(4);
    expect(diagnostics.abilitiesWithScaling).toBe(1);
    expect(diagnostics.statsAccepted).toBe(1);
    expect(diagnostics.statsQuarantined).toBe(1);
    expect(diagnostics.quarantineReasons.get("unknown-template:ccd")).toBe(1);
    expect(
      diagnostics.quarantineExamples.get("unknown-template:ccd")
    ).toContain("Yasuo Q: Crit Damage");
  });

  it("throws when the wiki API rejects the request", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(fetchChampionAbilityScaling(["Ahri"])).rejects.toThrow("503");
  });

  it("ignores a page whose declared slot contradicts the requested one", async () => {
    respondWith(
      [
        {
          title: "Template:Data Ahri/Elsewhere",
          champion: "Ahri",
          slot: "R",
          leveling: "{{st|Magic Damage|{{ap|35 to 135}}}}",
        },
      ],
      [{ from: "Template:Data Ahri/Q", to: "Template:Data Ahri/Elsewhere" }]
    );

    const result = await fetchChampionAbilityScaling(["Ahri"]);

    expect(result.byChampion.has("ahri")).toBe(false);
  });

  it("resolves titles the API normalizes before redirecting", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          normalized: [
            { from: "Template:Data Kai'Sa/Q", to: "Template:Data Kai'sa/Q" },
          ],
          redirects: [
            {
              from: "Template:Data Kai'sa/Q",
              to: "Template:Data Kai'Sa/Icathian Rain",
            },
          ],
          pages: [
            makePage({
              title: "Template:Data Kai'Sa/Icathian Rain",
              champion: "Kai'Sa",
              slot: "Q",
              leveling: "{{st|Magic Damage|{{ap|40 to 60}}}}",
            }),
          ],
        },
      }),
    });

    const result = await fetchChampionAbilityScaling(["Kai'Sa"]);

    expect(result.byChampion.get("kai'sa")?.slots.Q).toHaveLength(1);
  });
});

describe("describeQuarantineReason", () => {
  it("names the offending template so the audit can rank shapes", () => {
    expect(
      describeQuarantineReason({ kind: "unknown-template", template: "ccd" })
    ).toBe("unknown-template:ccd");
  });

  it("names the offending variable", () => {
    expect(
      describeQuarantineReason({ kind: "unresolved-variable", variable: "b1" })
    ).toBe("unresolved-variable:b1");
  });

  it("collapses arithmetic failures to a single bucket", () => {
    expect(
      describeQuarantineReason({
        kind: "arithmetic-failed",
        expression: "1 to 2 3",
      })
    ).toBe("arithmetic-failed");
  });

  it("renders reasons that carry no detail", () => {
    expect(describeQuarantineReason({ kind: "residual-markup" })).toBe(
      "residual-markup"
    );
  });
});
