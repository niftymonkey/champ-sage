/**
 * API-key-scoped cache invalidation for the meta-build collector.
 *
 * Riot encrypts PUUIDs to the API key that fetched them: a PUUID obtained with
 * one key returns 400 "Exception decrypting" when queried with a different key.
 * Dev keys rotate every 24 hours, so the collector's PUUID caches (high-elo
 * seeds, the discovered pool, the queried set) go stale on every key swap, while
 * match data (keyed by global match IDs) stays valid. These pure helpers let the
 * script detect a key change and purge only the key-scoped caches.
 */
import { createHash } from "node:crypto";

/**
 * A stable, non-reversible fingerprint of an API key (first 16 hex chars of its
 * SHA-256). Stored next to the caches to detect a key swap without persisting
 * the key itself.
 */
export function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

/**
 * Whether the PUUID caches must be purged: true when no fingerprint was recorded
 * yet (unknown prior key) or when the current key differs from the recorded one.
 */
export function shouldPurgePuuidCaches(
  stored: string | null,
  current: string
): boolean {
  return stored !== current;
}

/**
 * Riot rejects a PUUID encrypted for a different key with a 400 whose body
 * message contains "Exception decrypting". Detecting it lets the collector stop
 * loudly instead of silently treating the rejection as "player has no matches".
 */
export function isDecryptError(
  status: number,
  message: string | undefined
): boolean {
  return status === 400 && (message ?? "").toLowerCase().includes("decrypting");
}
