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
  description?: string;
}

function makePage(spec: PageSpec) {
  const leveling =
    spec.leveling === undefined ? "" : `\n|leveling     = ${spec.leveling}`;
  const description =
    spec.description === undefined
      ? ""
      : `\n|description  = ${spec.description}`;
  return {
    pageid: 1,
    title: spec.title,
    revisions: [
      {
        slots: {
          main: {
            content: `{{{{{1<noinclude>|Ability data</noinclude>}}}|An Ability|{{{2|}}}
|champion     = ${spec.champion}
|skill        = ${spec.slot}${description}${leveling}
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

  it("requests the innate page and every spell slot for each champion", async () => {
    respondWith([]);
    await fetchChampionAbilityScaling(["Ahri"]);

    const titles = new URL(requestedUrls()[0]).searchParams.get("titles");
    expect(titles?.split("|")).toEqual([
      "Template:Data Ahri/I",
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
    // 13 champions * 5 titles (innate + 4 spells) = 65, splitting across two.
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

  it("stores a cleanly rendered innate and omits one that cannot be trusted", async () => {
    respondWith(
      [
        {
          title: "Template:Data Morgana/Soul Siphon",
          champion: "Morgana",
          slot: "I",
          description:
            "'''Innate:''' {{as|Morgana}} heals herself for {{as|18%}} of the damage dealt by her abilities.",
        },
        {
          title: "Template:Data Yasuo/Way of the Wanderer",
          champion: "Yasuo",
          slot: "I",
          description: "Gains {{ccd|Yasuo|crit_base}} critical strike damage.",
        },
        {
          title: "Template:Data Yasuo/Q",
          champion: "Yasuo",
          slot: "Q",
          leveling: "{{st|Physical Damage|{{ap|20 to 120}}}}",
        },
      ],
      [
        {
          from: "Template:Data Morgana/I",
          to: "Template:Data Morgana/Soul Siphon",
        },
        {
          from: "Template:Data Yasuo/I",
          to: "Template:Data Yasuo/Way of the Wanderer",
        },
      ]
    );

    const result = await fetchChampionAbilityScaling(["Morgana", "Yasuo"]);

    expect(result.byChampion.get("morgana")?.innate).toBe(
      "Innate: Morgana heals herself for 18% of the damage dealt by her abilities."
    );
    expect(result.byChampion.get("morgana")?.slots).toEqual({});
    expect(result.byChampion.get("yasuo")?.innate).toBeUndefined();
    expect(result.byChampion.get("yasuo")?.slots.Q).toHaveLength(1);
  });

  it("rejects an innate redirect that lands on another champion's page", async () => {
    respondWith(
      [
        {
          title: "Template:Data Zed/Contempt for the Weak",
          champion: "Zed",
          slot: "I",
          description: "Zed's passive text.",
        },
        {
          title: "Template:Data Morgana/Soul Siphon",
          champion: "Morgana",
          slot: "I",
          description: "Morgana heals.",
        },
      ],
      [
        {
          from: "Template:Data Ahri/I",
          to: "Template:Data Zed/Contempt for the Weak",
        },
        {
          from: "Template:Data Morgana/I",
          to: "Template:Data Morgana/Soul Siphon",
        },
      ]
    );

    const result = await fetchChampionAbilityScaling(["Ahri", "Morgana"]);

    expect(result.byChampion.get("morgana")?.innate).toBe("Morgana heals.");
    expect(result.byChampion.has("ahri")).toBe(false);
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

  it("carries an abort signal on every wiki request", async () => {
    respondWith([]);

    await fetchChampionAbilityScaling(["Ahri"]);

    const init = mockFetch.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it("abandons a request that outlives the timeout", async () => {
    // A community wiki that accepts the connection and then stalls would
    // otherwise hold ingest open for as long as the socket stays alive, since
    // batches run one after another. Timing out drops into the same degrade
    // path as any other fetch rejection: warn, and ship the session without
    // ability scaling.
    mockFetch.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(init.signal.reason)
          );
        })
    );

    await expect(
      fetchChampionAbilityScaling(["Ahri"], { timeoutMs: 5 })
    ).rejects.toThrow(/abort|timeout/i);
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

  it("rejects a redirect that lands on a different champion's page", async () => {
    // Attributing one champion's damage numbers to another is the worst
    // failure this source can produce, so identity is verified, not assumed.
    respondWith(
      [
        {
          title: "Template:Data Zed/Razor Shuriken",
          champion: "Zed",
          slot: "Q",
          leveling: "{{st|Physical Damage|{{ap|80 to 240}}}}",
        },
      ],
      [{ from: "Template:Data Ahri/Q", to: "Template:Data Zed/Razor Shuriken" }]
    );

    const result = await fetchChampionAbilityScaling(["Ahri"]);

    expect(result.byChampion.has("ahri")).toBe(false);
    expect(result.byChampion.has("zed")).toBe(false);
  });

  it("rejects a page that declares no champion at all", async () => {
    respondWith([
      {
        title: "Template:Data Ahri/Q",
        champion: "",
        slot: "Q",
        leveling: "{{st|Magic Damage|{{ap|35 to 135}}}}",
      },
    ]);

    const result = await fetchChampionAbilityScaling(["Ahri"]);

    expect(result.byChampion.has("ahri")).toBe(false);
  });

  it("rejects a champion whose name merely prefixes the declared one", async () => {
    // "Vi" prefixes both "Viego" and "Viktor", so identity matching must be
    // exact rather than prefix-based.
    respondWith([
      {
        title: "Template:Data Vi/Q",
        champion: "Viego",
        slot: "Q",
        leveling: "{{st|Physical Damage|{{ap|10 to 20}}}}",
      },
    ]);

    const result = await fetchChampionAbilityScaling(["Vi"]);

    expect(result.byChampion.has("vi")).toBe(false);
  });

  it("accepts the wiki naming a compound champion by its primary name", async () => {
    // Data Dragon calls it "Nunu & Willump"; the wiki page declares "Nunu".
    respondWith(
      [
        {
          title: "Template:Data Nunu & Willump/Consume",
          champion: "Nunu",
          slot: "W",
          leveling: "{{st|Magic Damage|{{ap|85 to 265}}}}",
        },
      ],
      [
        {
          from: "Template:Data Nunu & Willump/W",
          to: "Template:Data Nunu & Willump/Consume",
        },
      ]
    );

    const result = await fetchChampionAbilityScaling(["Nunu & Willump"]);

    expect(result.byChampion.get("nunu & willump")?.slots.W).toEqual([
      { label: "Magic Damage", value: "85 to 265" },
    ]);
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
