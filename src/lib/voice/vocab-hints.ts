/**
 * Vocabulary hint builder for STT (speech-to-text) engines.
 *
 * STT engines struggle with fantasy/invented words common in League of Legends
 * (champion names, item names, augment names). Both Whisper and Deepgram support
 * vocabulary hinting — a list of words the engine should bias toward recognizing.
 *
 * However, vocabulary hint budgets are limited:
 * - Whisper: 224 tokens max in the `prompt` parameter
 * - Deepgram: 500 tokens / 100 keyterms in the `keyterm` parameter
 *
 * To fit within these limits, we apply two optimizations:
 *
 * 1. **Send only hard words, not full names.** "Rabadon's Deathcap" becomes
 *    just "Rabadon's" — "Deathcap" is common English that STT handles fine.
 *    This roughly halves token usage for multi-word names.
 *
 * 2. **Scope champions to the current match.** All 89 hard champion words would
 *    consume ~170 tokens alone. Since players almost exclusively discuss champions
 *    in their current game, we send only the ~10 match champions' hard words (~18
 *    tokens), freeing budget for items and augments.
 *
 * The combined output is ~188 tokens — fits Whisper's 224-token limit with margin.
 *
 * See docs/voice-input-research.md for the full analysis and word lists.
 */

/**
 * Hard-to-transcribe words from ARAM-purchasable item names.
 *
 * These are fantasy proper nouns, invented compounds, and archaic English words
 * that general-purpose STT engines consistently mangle. Common English words
 * from item names (e.g., "Deathcap", "Hourglass", "Chain Vest") are excluded
 * because STT handles them fine without hints.
 *
 * Selection criteria for inclusion:
 * - Fantasy/invented words: Rabadon's, Guinsoo's, Morellonomicon
 * - Game-specific compounds: Hextech, Chempunk, Chemtech
 * - Archaic English uncommon in speech: Solari, Malmortius, Navori
 * - Possessives of fantasy names: Zhonya's, Liandry's, Shurelya's
 *
 * Curated from 248 ARAM-purchasable items; 55 hard words identified.
 */
export const HARD_ITEM_WORDS: readonly string[] = [
  "Actualizer",
  "Anathema's",
  "Atma's",
  "Bami's",
  "Bandleglass",
  "Bandlepipes",
  "Battlesong",
  "Cappa",
  "Caulfield's",
  "Chempunk",
  "Chemtech",
  "Cryptbloom",
  "Dawncore",
  "Fiendhunter",
  "Fimbulwinter",
  "Guinsoo's",
  "Heartsteel",
  "Helia",
  "Hexdrinker",
  "Hexoptics",
  "Hexplate",
  "Hextech",
  "Jak'Sho",
  "Kaenic",
  "Kalista's",
  "Kindlegem",
  "Liandry's",
  "Luden's",
  "Malmortius",
  "Manamune",
  "Morellonomicon",
  "Muramana",
  "Nashor's",
  "Navori",
  "Phreakish",
  "Poro-Snax",
  "Rabadon's",
  "Rageblade",
  "Randuin's",
  "Riftmaker",
  "Rookern",
  "Runaan's",
  "Rylai's",
  "Serylda's",
  "Shojin",
  "Shurelya's",
  "Solari",
  "Statikk",
  "Sterak's",
  "Tal",
  "Witchcap",
  "Wooglet's",
  "Youmuu's",
  "Yun",
  "Zhonya's",
];

/**
 * Hard-to-transcribe words from Mayhem augment names.
 *
 * Augments are the primary use case for voice input — players must speak augment
 * names since the Riot API doesn't expose which options are on screen. Most
 * augment names are common English ("Heavy Hitter", "Circle of Death"), but
 * ~44 contain game-specific or invented words.
 *
 * After deduplication with HARD_ITEM_WORDS (shared words like "Hextech",
 * "Zhonya's", "Thornmail", "Witchcap", "Wooglet's", "Sheen", "Mikael's"),
 * ~37 unique augment-only hard words remain.
 *
 * Selection criteria — same as items, plus:
 * - Game jargon: Poro, Crit, Buff, Homeguard
 * - Unusual casing indicating game puns: ADAPt, EscAPADe, ReEnergize
 * - Invented compounds: Minionmancer, Marksmage, Nightstalking
 */
export const HARD_AUGMENT_WORDS: readonly string[] = [
  "ADAPt",
  "Brutalizer",
  "Buff",
  "Colossus",
  "Crit",
  "Dawnbringer's",
  "Dropkick",
  "Droppybara",
  "Earthwake",
  "Empyrean",
  "EscAPADe",
  "Fey",
  "Firebrand",
  "Flashbang",
  "Goldrend",
  "Goredrink",
  "Homeguard",
  "Icathia's",
  "Immolate",
  "Keystone",
  "Marksmage",
  "Mikael's",
  "Minionmancer",
  "Nightstalking",
  "Omni",
  "Popoffs",
  "Poro",
  "ReEnergize",
  "Repulsor",
  "Scopier",
  "Scopiest",
  "Sheen",
  "Sneakerhead",
  "Snowball",
  "Thornmail",
  "Transmute",
  "Trueshot",
  "Urf's",
  "Windspeaker's",
  "Witchful",
];

/**
 * All champion names that STT engines struggle with.
 *
 * Used as a lookup set: when building per-match vocab hints, each match
 * champion is checked against this set. Champions with common English names
 * (Annie, Diana, Graves, Karma, etc.) are excluded — STT transcribes them fine.
 *
 * 89 of 172 champions have fantasy/invented names requiring hints.
 * Multi-word champion names contribute individual hard words:
 * e.g., "Lee Sin" — "Lee" is fine, "Sin" is fine, neither needs hinting.
 * "Aurelion Sol" — "Aurelion" is fantasy (included), "Sol" is fine.
 */
export const HARD_CHAMPION_NAMES: ReadonlySet<string> = new Set([
  "Aatrox",
  "Ahri",
  "Akali",
  "Akshan",
  "Alistar",
  "Ambessa",
  "Amumu",
  "Anivia",
  "Aphelios",
  "Aurelion",
  "Azir",
  "Bel'Veth",
  "Blitzcrank",
  "Cassiopeia",
  "Cho'Gath",
  "Corki",
  "Ezreal",
  "Fiddlesticks",
  "Fizz",
  "Gangplank",
  "Gnar",
  "Gragas",
  "Hecarim",
  "Heimerdinger",
  "Hwei",
  "Illaoi",
  "Jarvan",
  "Jhin",
  "K'Sante",
  "Kai'Sa",
  "Kalista",
  "Karthus",
  "Kassadin",
  "Katarina",
  "Kayn",
  "Kennen",
  "Kha'Zix",
  "Kled",
  "Kog'Maw",
  "LeBlanc",
  "Lillia",
  "Lissandra",
  "Malphite",
  "Malzahar",
  "Maokai",
  "Milio",
  "Mordekaiser",
  "Mundo",
  "Naafiri",
  "Nidalee",
  "Nilah",
  "Orianna",
  "Qiyana",
  "Rakan",
  "Rammus",
  "Rek'Sai",
  "Renekton",
  "Rengar",
  "Ryze",
  "Sejuani",
  "Seraphine",
  "Shaco",
  "Shyvana",
  "Singed",
  "Skarner",
  "Soraka",
  "Sylas",
  "Tahm",
  "Taliyah",
  "Tristana",
  "Tryndamere",
  "Urgot",
  "Veigar",
  "Vel'Koz",
  "Viego",
  "Vladimir",
  "Volibear",
  "Wukong",
  "Xayah",
  "Xerath",
  "Xin",
  "Yasuo",
  "Yone",
  "Yunara",
  "Yuumi",
  "Zaahen",
  "Ziggs",
  "Zilean",
  "Zyra",
]);

/**
 * Build the vocabulary hint list for an STT transcription request.
 *
 * Combines static hard words (items + augments) with dynamic match-specific
 * champion names. The result is a deduplicated array of individual words
 * that STT engines should be biased toward recognizing.
 *
 * @param matchChampions - Names of all champions in the current match (up to 10)
 * @returns Deduplicated array of hard words, typically ~100 entries / ~188 tokens
 */
export function buildVocabHints(matchChampions: string[]): string[] {
  const hints = new Set<string>();

  // Add all static hard words (items + augments)
  for (const word of HARD_ITEM_WORDS) {
    hints.add(word);
  }
  for (const word of HARD_AUGMENT_WORDS) {
    hints.add(word);
  }

  // Add match-specific champion names, but only the hard ones.
  // Champions like "Annie" or "Diana" are common English names that
  // STT handles without help — no point wasting token budget on them.
  for (const champion of matchChampions) {
    if (HARD_CHAMPION_NAMES.has(champion)) {
      hints.add(champion);
    }
  }

  return [...hints];
}

/**
 * Format vocab hints as a Whisper-compatible glossary prompt string.
 *
 * Whisper's `prompt` parameter works best as a comma-separated glossary.
 * The format "Glossary: word1, word2, ..." is recommended by OpenAI's
 * Whisper prompting guide for steering spelling of proper nouns.
 *
 * @param hints - Array of hard words from buildVocabHints()
 * @returns Formatted glossary string for the Whisper prompt parameter
 */
export function formatWhisperGlossary(hints: string[]): string {
  if (hints.length === 0) return "";
  return `Glossary: ${hints.join(", ")}`;
}
