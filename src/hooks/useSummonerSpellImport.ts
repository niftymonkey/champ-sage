import { useCallback, useState } from "react";
import { applySummonerSpells } from "../lib/champ-select/apply-summoner-spells";
import type { SummonerSpellImportStatus } from "../components/SummonerSpellImport";

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
 * swallowed into the `error` status (the action logs the cause) so the button
 * can offer a retry without throwing into render.
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
      } catch {
        setStatus("error");
      }
    },
    [apply]
  );

  return { status, importSpells };
}
