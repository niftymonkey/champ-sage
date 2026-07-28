export interface Champion {
  id: string;
  key: number;
  name: string;
  title: string;
  tags: string[];
  partype: string;
  stats: ChampionStats;
  image: string;
  aramOverrides?: AramOverrides;
  abilities?: ChampionAbilities;
}

export interface ChampionAbilities {
  passive: AbilityPassive;
  spells: AbilitySpell[];
}

export interface AbilityPassive {
  name: string;
  description: string;
}

export interface AbilitySpell {
  id: string;
  name: string;
  description: string;
  maxRank: number;
  cooldowns: number[];
  costs: number[];
  range: number[];
  /**
   * Per-rank scaling sourced from the League Wiki, e.g.
   * `{ label: "Damage Per Pass", value: "35 to 135 (+ 50% AP)" }`.
   *
   * Riot's own feeds cannot supply this (DDragon serves unresolved
   * `{{ totaldamage }}` placeholders with empty `vars`; CommunityDragon serves
   * `@TotalDamage@` with zeroed coefficients), so the wiki is the only source.
   * Absent whenever the wiki fetch failed or every stat on the ability
   * quarantined: scaling is an enhancement, and omitting it is always
   * preferable to feeding a coach wrong numbers.
   */
  scaling?: AbilityScalingStat[];
}

/** One row of a wiki ability leveling table, condensed to rank-1-to-max form. */
export interface AbilityScalingStat {
  /** Stat name, e.g. "Magic Damage". */
  label: string;
  /** Condensed value, e.g. "35 to 135 (+ 50% AP)". */
  value: string;
}

export interface AramOverrides {
  dmgDealt: number;
  dmgTaken: number;
  healing?: number;
  shielding?: number;
  tenacity?: number;
  energyRegenMod?: number;
  totalAs?: number;
  abilityHaste?: number;
}

export interface ChampionStats {
  hp: number;
  hpperlevel: number;
  mp: number;
  mpperlevel: number;
  movespeed: number;
  armor: number;
  armorperlevel: number;
  spellblock: number;
  spellblockperlevel: number;
  attackrange: number;
  hpregen: number;
  hpregenperlevel: number;
  mpregen: number;
  mpregenperlevel: number;
  attackdamage: number;
  attackdamageperlevel: number;
  attackspeed: number;
  attackspeedperlevel: number;
}

export type ItemMode = "standard" | "arena" | "aram" | "swarm" | "other";

export interface Item {
  id: number;
  name: string;
  description: string;
  plaintext: string;
  gold: ItemGold;
  tags: string[];
  stats: Record<string, number>;
  from?: number[];
  into?: number[];
  image: string;
  mode: ItemMode;
  /**
   * DDragon map IDs this item is actually available on (11 = Summoner's Rift,
   * 12/14 = ARAM, 30 = Arena). This is the durable "purchasable in this mode"
   * signal, unlike the ID-range `mode` partition which mislabels items (an
   * `aram`-range id can be SR-only). Empty means available nowhere (deprecated
   * or internal items), which excludes it from every catalog.
   */
  maps: number[];
  /**
   * Mutually exclusive purchase groups this item belongs to, sourced from the
   * League Wiki ItemData `itemlimit`/`itemlimit2` fields (e.g. "Fatality" for
   * the Last Whisper family). The game caps ownership at ONE item per group,
   * so a build path must never contain two items sharing a group. Riot's own
   * feeds cannot supply this: DDragon's top-level `groups` array names the
   * groups (with MaxGroupOwnable) but no item carries a membership field, and
   * CommunityDragon mirrors the same gap. Absent when the wiki fetch failed or
   * the item has no group restriction.
   */
  mutexGroups?: string[];
}

export interface ItemGold {
  base: number;
  total: number;
  sell: number;
  purchasable: boolean;
}

export interface RuneTree {
  id: number;
  key: string;
  name: string;
  icon: string;
  keystones: Rune[];
  slots: Rune[][];
}

export interface Rune {
  id: number;
  key: string;
  name: string;
  icon: string;
  shortDesc: string;
  longDesc: string;
}

export type AugmentMode = "mayhem" | "arena" | "swarm" | "unknown";

export interface Augment {
  name: string;
  description: string;
  tier: "Silver" | "Gold" | "Prismatic";
  sets: string[];
  mode: AugmentMode;
  id?: number;
  iconPath?: string;
}

export interface AugmentSetBonus {
  threshold: number;
  description: string;
}

export interface AugmentSet {
  name: string;
  bonuses: AugmentSetBonus[];
}

export interface GameData {
  version: string;
  champions: Map<string, Champion>;
  items: Map<number, Item>;
  runes: RuneTree[];
  augments: Map<string, Augment>;
  augmentSets: AugmentSet[];
}

export interface EntityDictionary {
  allNames: string[];
  champions: string[];
  items: string[];
  augments: string[];
  search(query: string): EntityMatch[];
  /** Find entity names mentioned within a block of text */
  findInText(text: string): EntityMatch[];
}

export interface EntityMatch {
  name: string;
  type: "champion" | "item" | "augment";
  score: number;
}
