/**
 * Print a champion's raw innate wikitext next to what the parser makes of it.
 *
 * The innate path renders prose, so its failures are not exceptions: they are
 * sentences that read wrong (a dropped word, a duplicated one, a stray
 * duration). Seeing the source template beside the rendered string is the only
 * way to tell which template shape produced the damage.
 *
 * Usage: pnpm dump-wiki-innate Braum Morgana
 */
import { parseInnateTemplate } from "../src/lib/data-ingest/parsers/wiki-ability-template";

const WIKI_API = "https://wiki.leagueoflegends.com/en-us/api.php";
const USER_AGENT =
  "champ-sage/1.0 (https://github.com/niftymonkey/champ-sage) innate-debug";

interface WikiQueryResponse {
  query?: {
    pages?: Array<{
      title?: string;
      revisions?: Array<{ slots?: { main?: { content?: string } } }>;
    }>;
  };
}

async function fetchInnateWikitext(champion: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    titles: `Template:Data ${champion}/I`,
    redirects: "1",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    format: "json",
    formatversion: "2",
  });

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`wiki API ${res.status} for ${champion}`);

  const body = (await res.json()) as WikiQueryResponse;
  return body.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? null;
}

/** The description params are the only ones the innate renderer reads. */
function descriptionLines(wikitext: string): string[] {
  return wikitext
    .split("\n")
    .filter((line) => /^\|\s*description\d*\s*=/.test(line));
}

const champions = process.argv.slice(2);
if (champions.length === 0) {
  console.error("Usage: pnpm dump-wiki-innate <Champion...>");
  process.exit(1);
}

for (const champion of champions) {
  const wikitext = await fetchInnateWikitext(champion);
  console.log(`\n=== ${champion} ===`);
  if (!wikitext) {
    console.log("  no /I page");
    continue;
  }

  console.log("\n--- raw description params ---");
  for (const line of descriptionLines(wikitext)) console.log(line);

  const parsed = parseInnateTemplate(wikitext);
  console.log("\n--- rendered ---");
  console.log(
    parsed.description ?? `(quarantined: ${parsed.quarantine?.kind})`
  );
}
