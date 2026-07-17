/**
 * Spike: what scaling data (AP/AD ratios, damage-per-rank) is actually
 * available for champion abilities, and from which source?
 *
 * The prompt currently carries only ability name + description, which has no
 * numbers in it. This probes the candidate sources for the numbers behind
 * an ability (the "40/65/90/115/140 (+50% AP)" line a wiki shows):
 *
 *   - Data Dragon champion/{id}.json: spells[].tooltip with {{ }} placeholders,
 *     plus effect/effectBurn arrays and a vars array of scaling coefficients.
 *   - Community Dragon champions/{key}.json: spells[].dynamicDescription with
 *     @token@ placeholders, plus coefficients / effectAmounts.
 *   - Meraki Analytics: resolved per-rank values plus scaling units.
 *
 * Finding (2026-07-17): none of them can supply it. Both Riot sources serve
 * unresolved placeholders over zeroed effect/coefficient arrays, and Meraki
 * now 404s. The wiki's `Template:Data {Champion}/{Ability}` is the viable
 * source. See docs/reference/technical-reference.md.
 *
 * Usage: pnpm spike-ability-scaling [ChampionId] [numericKey]
 *        pnpm spike-ability-scaling Ahri 103
 */

import { fetchLatestVersion } from "../src/lib/data-ingest/sources/data-dragon";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const CDRAGON =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";
const MERAKI = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en";

const RULE = "=".repeat(70);

interface DDragonSpell {
  id: string;
  name: string;
  tooltip?: string;
  effectBurn?: (string | null)[];
  vars?: unknown[];
  costBurn?: string;
  cooldownBurn?: string;
  rangeBurn?: string;
}

interface DDragonChampionFull {
  spells?: DDragonSpell[];
}

interface CDragonSpell {
  name?: string;
  spellKey?: string;
  dynamicDescription?: string;
  coefficients?: Record<string, number>;
  effectAmounts?: Record<string, unknown>;
  costCoefficients?: number[];
}

interface CDragonChampion {
  name?: string;
  spells?: CDragonSpell[];
}

interface MerakiAbility {
  name?: string;
  cost?: unknown;
  cooldown?: unknown;
  effects?: unknown;
}

interface MerakiChampion {
  name?: string;
  patch?: string;
  abilities?: Record<string, MerakiAbility[]>;
}

/** Fetch and parse JSON, reporting non-2xx rather than throwing past the caller. */
async function getJson<T>(url: string, label: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

async function probeDataDragon(version: string, championId: string) {
  const json = await getJson<{ data?: Record<string, DDragonChampionFull> }>(
    `${DDRAGON}/cdn/${version}/data/en_US/champion/${championId}.json`,
    "DDragon"
  );
  const data = json?.data?.[championId];
  if (!data?.spells) {
    console.log("DDragon: champion not found");
    return;
  }

  console.log(`\n${RULE}\nDATA DRAGON: ${championId}\n${RULE}`);
  for (const spell of data.spells) {
    console.log(`\n--- ${spell.name} (${spell.id}) ---`);
    console.log(`tooltip:      ${spell.tooltip}`);
    console.log(`effectBurn:   ${JSON.stringify(spell.effectBurn)}`);
    console.log(`vars:         ${JSON.stringify(spell.vars)}`);
    console.log(`costBurn:     ${spell.costBurn}`);
    console.log(`cooldownBurn: ${spell.cooldownBurn}`);
    console.log(`rangeBurn:    ${spell.rangeBurn}`);
  }
}

async function probeCommunityDragon(numericKey: string) {
  const json = await getJson<CDragonChampion>(
    `${CDRAGON}/champions/${numericKey}.json`,
    "CDragon"
  );
  if (!json) return;

  console.log(`\n${RULE}\nCOMMUNITY DRAGON: ${json.name}\n${RULE}`);
  for (const spell of json.spells ?? []) {
    console.log(`\n--- ${spell.name} (${spell.spellKey}) ---`);
    console.log(`dynamicDescription: ${spell.dynamicDescription}`);
    console.log(`coefficients:       ${JSON.stringify(spell.coefficients)}`);
    console.log(
      `effectAmounts keys: ${Object.keys(spell.effectAmounts ?? {}).join(", ")}`
    );
    console.log(
      `costCoefficients:   ${JSON.stringify(spell.costCoefficients)}`
    );
  }
}

/**
 * Meraki resolved Riot's spell calculations into concrete per-rank values plus
 * scaling units, which is what the wiki renders. As of 2026-07-17 the CDN
 * returns 404 for every champion; treat the project as dead unless this
 * probe starts succeeding again.
 */
async function probeMeraki(championId: string) {
  const json = await getJson<MerakiChampion>(
    `${MERAKI}/champions/${championId}.json`,
    "Meraki"
  );
  if (!json) return;

  console.log(`\n${RULE}\nMERAKI: ${json.name} (patch ${json.patch})\n${RULE}`);
  for (const [key, spells] of Object.entries(json.abilities ?? {})) {
    for (const spell of spells) {
      console.log(`\n--- [${key}] ${spell.name} ---`);
      console.log(`cost:      ${JSON.stringify(spell.cost)}`);
      console.log(`cooldown:  ${JSON.stringify(spell.cooldown)}`);
      console.log(`effects:   ${JSON.stringify(spell.effects, null, 2)}`);
    }
  }
}

/** Run a probe without letting one dead source abort the others. */
async function runProbe(label: string, probe: () => Promise<void>) {
  try {
    await probe();
  } catch (err) {
    console.log(`${label}: probe failed: ${String(err)}`);
  }
}

async function main() {
  const championId = process.argv[2] ?? "Ahri";
  const numericKey = process.argv[3] ?? "103";

  // The version lookup only DDragon needs, so keep its failure inside
  // DDragon's probe. The CDragon and Meraki probes do not take a version and
  // must still run when it dies; the whole point of this spike is comparing
  // sources, which a single dead source should not prevent.
  await runProbe("DDragon", async () => {
    const version = await fetchLatestVersion();
    console.log(`DDragon version: ${version}`);
    await probeDataDragon(version, championId);
  });
  await runProbe("CDragon", () => probeCommunityDragon(numericKey));
  await runProbe("Meraki", () => probeMeraki(championId));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
