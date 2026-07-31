import type { AbilityScalingStat } from "../types";
import {
  parseAbilityTemplate,
  parseInnateTemplate,
  type QuarantineReason,
  type SpellSlot,
} from "../parsers/wiki-ability-template";

const WIKI_API = "https://wiki.leagueoflegends.com/en-us/api.php";

/**
 * The MediaWiki API caps a query at 50 titles for unauthenticated clients and
 * silently truncates beyond it, so batches must stay at or under this.
 */
const TITLES_PER_REQUEST = 50;

/**
 * The wiki rejects requests without a User-Agent with HTTP 403, so identify the
 * app per MediaWiki's API etiquette rather than letting ingest fail.
 */
const USER_AGENT =
  "champ-sage/1.0 (https://github.com/niftymonkey/champ-sage) ability-scaling-ingest";

/**
 * How long a single wiki request may run before it is abandoned.
 *
 * Batches run one after another, so a community wiki that accepts the
 * connection and then stalls would hold the whole ingest open for as long as
 * the socket stays alive. Timing out converts that hang into the rejection the
 * caller already degrades on (warn, and ship the session without scaling).
 * Generous relative to a healthy response (well under a second) because slow is
 * still useful here and a false abort costs the roster its scaling.
 */
const REQUEST_TIMEOUT_MS = 15_000;

const SPELL_SLOTS: readonly SpellSlot[] = ["Q", "W", "E", "R"];

/**
 * The innate (passive) page slot. Requested alongside the spell slots but
 * parsed as prose rather than rank-based stats, because innate pages scale
 * with champion level and carry no `leveling` params.
 */
const INNATE_SLOT = "I";

type RequestedSlot = SpellSlot | typeof INNATE_SLOT;

/** Keep a couple of offenders per reason: enough to debug, not a wall of text. */
const MAX_EXAMPLES_PER_REASON = 3;

export interface ChampionAbilityScaling {
  /** Clean scaling per spell slot. A slot is absent when nothing survived. */
  slots: Partial<Record<SpellSlot, AbilityScalingStat[]>>;
  /**
   * Plain-text innate (passive) description rendered from the wiki `/I` page.
   * Absent when the page is missing or its rendering could not be trusted, in
   * which case the DDragon passive text stays in place.
   */
  innate?: string;
}

export interface ScalingDiagnostics {
  abilitiesRequested: number;
  abilitiesWithScaling: number;
  statsAccepted: number;
  statsQuarantined: number;
  /** Quarantine reason (rendered as a stable label) to occurrence count. */
  quarantineReasons: Map<string, number>;
  /** Up to a few example offenders per reason, for the audit report. */
  quarantineExamples: Map<string, string[]>;
}

export interface WikiAbilityScalingOptions {
  /** Per-request timeout. Defaults to `REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface WikiAbilityScalingResult {
  /** Keyed by lowercased champion name, matching the champions map key. */
  byChampion: Map<string, ChampionAbilityScaling>;
  diagnostics: ScalingDiagnostics;
}

/**
 * Collapse a quarantine reason to a stable bucket label. Template and variable
 * names are kept because they name the shape to teach the parser next; failed
 * expressions are not, because they are all distinct and would shatter the
 * histogram into buckets of one.
 */
export function describeQuarantineReason(reason: QuarantineReason): string {
  switch (reason.kind) {
    case "unknown-template":
      return `unknown-template:${reason.template}`;
    case "unresolved-variable":
      return `unresolved-variable:${reason.variable}`;
    default:
      return reason.kind;
  }
}

/** The shape of the MediaWiki `action=query&formatversion=2` response we use. */
interface WikiQueryResponse {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: WikiPage[];
  };
}

interface WikiPage {
  title?: string;
  missing?: boolean;
  revisions?: Array<{ slots?: { main?: { content?: string } } }>;
}

/**
 * Fetch per-ability scaling for the given champions from the League Wiki.
 *
 * Riot's own feeds serve these numbers as unresolved placeholders, so the wiki
 * is the only source that has them. Ability pages live at
 * `Template:Data <Champion>/<Slot>`, where the slot form is a redirect to the
 * ability's real name ("Data Ahri/Q" to "Data Ahri/Orb of Deception"), so
 * `redirects=1` is load-bearing rather than a convenience. The innate page
 * (`/I`) rides along in the same batches and supplies the passive's prose
 * description, replacing DDragon's numberless flavor text.
 *
 * Titles are batched to the API's 50-title cap and fetched sequentially: this
 * runs at ingest for the full roster (~18 requests), and a burst of parallel
 * requests to a community wiki is not worth the couple of seconds it saves.
 */
export async function fetchChampionAbilityScaling(
  championNames: string[],
  options: WikiAbilityScalingOptions = {}
): Promise<WikiAbilityScalingResult> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const titleToChampion = new Map<
    string,
    { champion: string; slot: RequestedSlot }
  >();
  for (const champion of championNames) {
    titleToChampion.set(abilityTitle(champion, INNATE_SLOT), {
      champion,
      slot: INNATE_SLOT,
    });
    for (const slot of SPELL_SLOTS) {
      titleToChampion.set(abilityTitle(champion, slot), { champion, slot });
    }
  }

  // Diagnostics count spell abilities only: the innate has no stat parse to
  // measure, and folding it in would skew the coverage denominator.
  const spellTitlesRequested = [...titleToChampion.values()].filter(
    (requested) => requested.slot !== INNATE_SLOT
  ).length;

  const byChampion = new Map<string, ChampionAbilityScaling>();
  const diagnostics: ScalingDiagnostics = {
    abilitiesRequested: spellTitlesRequested,
    abilitiesWithScaling: 0,
    statsAccepted: 0,
    statsQuarantined: 0,
    quarantineReasons: new Map(),
    quarantineExamples: new Map(),
  };

  for (const batch of chunk([...titleToChampion.keys()], TITLES_PER_REQUEST)) {
    const body = await fetchBatch(batch, timeoutMs);
    const resolve = buildTitleResolver(body);

    for (const page of body.query?.pages ?? []) {
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (!page.title || !content) continue;

      const requestedTitle = resolve(page.title);
      const requested = requestedTitle
        ? titleToChampion.get(requestedTitle)
        : undefined;
      if (!requested) continue;

      if (requested.slot === INNATE_SLOT) {
        // Innate pages carry the same identity risks as spell pages (the /I
        // form is a redirect too), so champion and slot are verified the same
        // way. A null description means the page was untrustworthy or empty;
        // either way the DDragon passive text stays in place.
        const innate = parseInnateTemplate(content);
        if (
          innate.slot !== INNATE_SLOT ||
          !championMatches(requested.champion, innate.champion)
        ) {
          continue;
        }
        if (innate.description === null) {
          // Reason histogram only: statsQuarantined stays a spell-stat count.
          if (innate.quarantine) {
            recordQuarantine(
              diagnostics,
              requested,
              "innate",
              innate.quarantine
            );
          }
          continue;
        }
        const key = requested.champion.toLowerCase();
        const entry = byChampion.get(key) ?? { slots: {} };
        entry.innate = innate.description;
        byChampion.set(key, entry);
        continue;
      }

      const parsed = parseAbilityTemplate(content);

      // A page reached through a redirect must still describe the champion AND
      // the slot we asked for. A mismatch means the redirect landed somewhere
      // unexpected, and attributing those numbers to this ability would be a
      // silent lie. Checking the slot alone would let a redirect to another
      // champion's same-slot page through, which is the worst outcome this
      // source can produce.
      if (
        parsed.slot !== requested.slot ||
        !championMatches(requested.champion, parsed.champion)
      ) {
        continue;
      }

      for (const dropped of parsed.quarantined) {
        diagnostics.statsQuarantined++;
        recordQuarantine(diagnostics, requested, dropped.label, dropped.reason);
      }

      if (parsed.stats.length === 0) continue;

      diagnostics.abilitiesWithScaling++;
      diagnostics.statsAccepted += parsed.stats.length;

      const key = requested.champion.toLowerCase();
      const entry = byChampion.get(key) ?? { slots: {} };
      entry.slots[requested.slot] = parsed.stats;
      byChampion.set(key, entry);
    }
  }

  return { byChampion, diagnostics };
}

function abilityTitle(champion: string, slot: RequestedSlot): string {
  return `Template:Data ${champion}/${slot}`;
}

function normalizeChampionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Whether a page's declared champion is the one we asked for.
 *
 * Matched exactly (after casing/punctuation normalization) rather than by
 * prefix, because several champion names prefix another's ("Vi" prefixes both
 * "Viego" and "Viktor") and a prefix rule would wave through exactly the
 * cross-champion redirect this guards against.
 *
 * The one accepted divergence is the wiki naming a compound champion by its
 * primary name: Data Dragon's "Nunu & Willump" is "Nunu" on the wiki. Derived
 * from the "&" convention rather than a hardcoded roster, so a future compound
 * champion needs no change here.
 */
function championMatches(requested: string, declared: string | null): boolean {
  if (!declared) return false;

  const normalizedDeclared = normalizeChampionName(declared);
  if (normalizedDeclared === "") return false;

  const accepted = new Set([
    normalizeChampionName(requested),
    normalizeChampionName(requested.split("&")[0]),
  ]);

  return accepted.has(normalizedDeclared);
}

async function fetchBatch(
  titles: string[],
  timeoutMs: number
): Promise<WikiQueryResponse> {
  const params = new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    redirects: "1",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    format: "json",
    formatversion: "2",
  });

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch champion ability scaling: ${res.status}`);
  }

  return (await res.json()) as WikiQueryResponse;
}

/**
 * Map a resolved page title back to the title we asked for.
 *
 * The API reports title normalization and redirects as separate hops, and a
 * title can take both (normalized, then redirected), so the chain is walked
 * backwards until it reaches a title we requested.
 */
function buildTitleResolver(
  body: WikiQueryResponse
): (title: string) => string | null {
  const toSource = new Map<string, string>();
  for (const hop of body.query?.normalized ?? [])
    toSource.set(hop.to, hop.from);
  for (const hop of body.query?.redirects ?? []) toSource.set(hop.to, hop.from);

  return (title: string) => {
    let current = title;
    // Bounded to defend against a cyclic redirect chain in wiki data.
    for (let hops = 0; hops <= 10; hops++) {
      const source = toSource.get(current);
      if (source === undefined || source === current) return current;
      current = source;
    }
    return null;
  };
}

function recordQuarantine(
  diagnostics: ScalingDiagnostics,
  requested: { champion: string; slot: RequestedSlot },
  label: string,
  reason: QuarantineReason
): void {
  const bucket = describeQuarantineReason(reason);
  diagnostics.quarantineReasons.set(
    bucket,
    (diagnostics.quarantineReasons.get(bucket) ?? 0) + 1
  );

  const examples = diagnostics.quarantineExamples.get(bucket) ?? [];
  if (examples.length < MAX_EXAMPLES_PER_REASON) {
    examples.push(`${requested.champion} ${requested.slot}: ${label}`);
    diagnostics.quarantineExamples.set(bucket, examples);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
