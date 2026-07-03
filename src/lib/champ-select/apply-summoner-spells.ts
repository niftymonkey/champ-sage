/**
 * Champ-select action: write the player's recommended summoner spells into the
 * League client.
 *
 * Bridges the renderer-side recommendation (a meta-derived spell pair) to the
 * main-process LCU write. Credentials come from the engine's `lcuCredentials$`
 * and the transport from the Electron bridge; both are injectable so the action
 * is unit-testable without a live client or IPC. The UI calls this only on an
 * explicit player click, never automatically.
 */

import { lcuCredentials$ } from "../reactive";
import { createElectronBridge } from "../reactive/electron-bridge";
import type { PlatformBridge } from "../reactive/platform-bridge";
import { getLogger } from "../logger";

const log = getLogger("champ-select");

export interface ApplySummonerSpellsDeps {
  bridge?: PlatformBridge;
  credentials?: { port: number; token: string } | null;
}

/**
 * Set the local player's summoner spells to the given pair. Throws when no LCU
 * connection is available so the caller can surface a failure to the player.
 */
export async function applySummonerSpells(
  spell1Id: number,
  spell2Id: number,
  deps: ApplySummonerSpellsDeps = {}
): Promise<void> {
  const credentials =
    deps.credentials !== undefined
      ? deps.credentials
      : lcuCredentials$.getValue();
  if (!credentials) {
    throw new Error("Cannot set summoner spells: LCU not connected");
  }

  const bridge = deps.bridge ?? createElectronBridge();
  log.info(`set spells ${spell1Id} + ${spell2Id}`);
  await bridge.setSummonerSpells(
    credentials.port,
    credentials.token,
    spell1Id,
    spell2Id
  );
}
