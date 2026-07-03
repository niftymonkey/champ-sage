import { useCallback, useState } from "react";
import { applySummonerSpells } from "../lib/champ-select/apply-summoner-spells";
import { getLogger } from "../lib/logger";

const log = getLogger("champ-select");

/**
 * The Import button's status-machine states. Owned here because this hook is the
 * source of truth for the status; the presentational component imports it from
 * the hook, keeping the dependency pointing component -> hook.
 */
export type SummonerSpellImportStatus = "idle" | "importing" | "done" | "error";

export interface UseSummonerSpellImportDeps {
  /** Injectable for tests; defaults to the real LCU write action. */
  apply?: (spell1Id: number, spell2Id: number) => Promise<void>;
}

export interface SummonerSpellImport {
  status: SummonerSpellImportStatus;
  importSpells: (spell1Id: number, spell2Id: number) => Promise<void>;
}

/**
 * Drives the summoner-spell Import button's status machine: idle, then
 * importing while the LCU write is in flight, then done or error. Failures are
 * logged here and folded into the `error` status (never thrown into render) so
 * the button can offer a retry and the cause stays diagnosable in the logs.
 */
export function useSummonerSpellImport(
  deps: UseSummonerSpellImportDeps = {}
): SummonerSpellImport {
  const apply = deps.apply ?? applySummonerSpells;
  const [status, setStatus] = useState<SummonerSpellImportStatus>("idle");

  const importSpells = useCallback(
    async (spell1Id: number, spell2Id: number) => {
      setStatus("importing");
      try {
        await apply(spell1Id, spell2Id);
        setStatus("done");
      } catch (err) {
        log.error(
          `summoner spell import failed (${spell1Id} + ${spell2Id})`,
          err
        );
        setStatus("error");
      }
    },
    [apply]
  );

  return { status, importSpells };
}
