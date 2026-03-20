export type ConnectionStatus = "disconnected" | "loading" | "connected";

export interface GameState {
  status: ConnectionStatus;
  activePlayer: ActivePlayer | null;
  players: PlayerInfo[];
  gameMode: string;
  gameTime: number;
}

export interface ActivePlayer {
  championName: string;
  level: number;
  currentGold: number;
  runes: ActivePlayerRunes;
  stats: ActivePlayerStats;
}

export interface ActivePlayerRunes {
  keystone: string;
  primaryTree: string;
  secondaryTree: string;
}

export interface ActivePlayerStats {
  abilityPower: number;
  armor: number;
  attackDamage: number;
  attackSpeed: number;
  abilityHaste: number;
  critChance: number;
  magicResist: number;
  moveSpeed: number;
  maxHealth: number;
  currentHealth: number;
}

export interface PlayerInfo {
  championName: string;
  team: "ORDER" | "CHAOS";
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  items: PlayerItem[];
  summonerSpells: [string, string];
  riotIdGameName: string;
  isActivePlayer: boolean;
}

export interface PlayerItem {
  id: number;
  name: string;
}
