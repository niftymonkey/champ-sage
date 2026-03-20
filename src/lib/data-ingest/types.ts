export interface Champion {
  id: string;
  key: number;
  name: string;
  title: string;
  tags: string[];
  partype: string;
  stats: ChampionStats;
  image: string;
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
  set: string;
  mode: AugmentMode;
  id?: number;
  iconPath?: string;
}

export interface GameData {
  version: string;
  champions: Map<string, Champion>;
  items: Map<number, Item>;
  runes: RuneTree[];
  augments: Map<string, Augment>;
}

export interface EntityDictionary {
  allNames: string[];
  champions: string[];
  items: string[];
  augments: string[];
  search(query: string): EntityMatch[];
}

export interface EntityMatch {
  name: string;
  type: "champion" | "item" | "augment";
  score: number;
}
