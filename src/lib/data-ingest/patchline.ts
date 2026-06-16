/**
 * A patchline is the live/PBE choice a player makes in the Riot launcher
 * (Riot's own term, e.g. the `patchlines` key in RiotClientInstalls.json).
 *
 * This module owns the single source of truth for what a patchline *means*
 * across the system: which Community Dragon data branch it reads, and which
 * cache namespace its assembled game data occupies. Keeping that mapping in
 * one place is what lets live and PBE data coexist without clobbering, and
 * keeps the meaning of "pbe" from drifting across call sites.
 */
export type Patchline = "live" | "pbe";

/**
 * The Community Dragon branch segment for a patchline. Live data lives under
 * the `latest` branch; PBE under the parallel `pbe` branch.
 */
export function cdragonBranch(patchline: Patchline): string {
  return patchline === "pbe" ? "pbe" : "latest";
}

/**
 * The localStorage cache key for a patchline's assembled game data. Namespaced
 * per patchline so a live cache and a PBE cache persist side by side: switching
 * which client you play never overwrites the other patchline's data.
 */
export function patchlineCacheKey(patchline: Patchline): string {
  return `game-data:${patchline}`;
}

/**
 * Map an LCU region (from `/riotclient/region-locale`) to a patchline. The PBE
 * client reports region "PBE"; every live shard (NA, EUW, KR, ...) is live.
 * Case- and whitespace-insensitive.
 */
export function patchlineFromRegion(region: string): Patchline {
  return region.trim().toUpperCase() === "PBE" ? "pbe" : "live";
}
