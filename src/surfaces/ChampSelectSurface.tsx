import { usePlayerBuildDirection } from "../hooks/usePlayerBuildDirection";
import type { LoadedGameData } from "../lib/data-ingest";
import type { Champion } from "../lib/data-ingest/types";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { resolveChampionName } from "../lib/data-ingest/champion-id-map";
import type { RawChampSelectMember } from "../lib/reactive/types";
import { setPlayerBuildDirection } from "../lib/reactive/build-direction-store";
import { BuildDirectionPicker } from "../components/BuildDirectionPicker";
import { SummonerSpellImport } from "../components/SummonerSpellImport";
import { useSummonerSpellImport } from "../hooks/useSummonerSpellImport";
import {
  deriveRecommendedSpells,
  getChampionMeta,
} from "../lib/data-ingest/meta-builds";
import type { BuildDirection } from "../lib/build-direction/taxonomy";
import styles from "./ChampSelectSurface.module.css";

interface ChampSelectSurfaceProps {
  data: LoadedGameData;
}

interface SlotData {
  champion: Champion | undefined;
  isMine: boolean;
  pending: boolean;
  /** Meta-recommended summoner-spell pair for the local player's champion. */
  recommendedSpells?: [number, number];
}

/**
 * Renders the v16 champ-select surface from the LCU's
 * /lol-champ-select/v1/session payload. Practice Tool's lobby (where bots
 * are configured) does NOT populate this URI - the LCU starts streaming
 * /lol-champ-select/v1/session only once the ChampSelect phase begins,
 * which Practice Tool reaches the moment the user clicks Play. So this
 * surface only ever needs the one data source; pre-ChampSelect renders the
 * empty state.
 */
export function ChampSelectSurface({ data }: ChampSelectSurfaceProps) {
  const liveGame = useLiveGameState();
  const session = liveGame.champSelect;
  const playerDirection = usePlayerBuildDirection();

  if (!session) {
    return (
      <div className={styles.surface}>
        <div className={styles.empty}>
          <h1 className={styles.emptyHeadline}>Listening to champ select.</h1>
          <p className={styles.emptySubhead}>
            Hang tight - this surface populates the moment the LCU emits the
            session.
          </p>
        </div>
      </div>
    );
  }

  const localCellId = session.localPlayerCellId ?? -1;
  const ally = (session.myTeam ?? []).map((m) =>
    toSlotData(m, data, localCellId)
  );
  const enemy = (session.theirTeam ?? []).map((m) =>
    toSlotData(m, data, localCellId)
  );

  return (
    <div className={styles.surface}>
      <div className={styles.eyebrow}>Champ select</div>

      <div className={styles.strip}>
        <div className={styles.team}>
          {ally.map((slot, i) => (
            <Slot
              key={`ally-${i}`}
              slot={slot}
              playerDirection={playerDirection}
              onPickDirection={setPlayerBuildDirection}
            />
          ))}
        </div>
        <div className={styles.divider}>
          <span className={styles.dividerLine} />
          <span className={styles.dividerLabel}>vs</span>
          <span className={styles.dividerLine} />
        </div>
        <div className={`${styles.team} ${styles.teamRight}`}>
          {enemy.map((slot, i) => (
            <Slot key={`enemy-${i}`} slot={slot} />
          ))}
        </div>
      </div>

      <div className={styles.read}>
        <h2 className={styles.readHeading}>Reading the matchup.</h2>
        <p className={styles.readBody}>
          Coach analysis of team comps and a starter recommendation will stream
          in here once the champ-select coaching feature ships in Phase 5. For
          now, the strip above reflects the current LCU session live.
        </p>
      </div>
    </div>
  );
}

function toSlotData(
  member: RawChampSelectMember,
  data: LoadedGameData,
  localCellId: number
): SlotData {
  const locked = member.championId ?? 0;
  const intent = member.championPickIntent ?? 0;
  const id = locked > 0 ? locked : intent;
  const championName = id > 0 ? resolveChampionName(id) : undefined;
  const champion = championName
    ? data.champions.get(championName.toLowerCase())
    : undefined;
  const isMine = member.cellId === localCellId;
  // Recommend off the ARAM index, the designed Mayhem proxy. Only the local
  // player's slot can act on it, so skip the lookup for everyone else.
  const recommendedSpells =
    isMine && champion
      ? deriveRecommendedSpells(
          getChampionMeta(data.metaBuilds?.aram ?? null, champion.key)
        )
      : undefined;
  return {
    champion,
    isMine,
    pending: id > 0 && locked === 0,
    recommendedSpells,
  };
}

interface SlotProps {
  slot: SlotData;
  playerDirection?: BuildDirection | null;
  onPickDirection?: (next: BuildDirection) => void;
}

function Slot({ slot, playerDirection, onPickDirection }: SlotProps) {
  return (
    <div className={`${styles.slot} ${slot.isMine ? styles.slotMine : ""}`}>
      {slot.isMine ? <span className={styles.slotMineEyebrow}>You</span> : null}
      {slot.champion ? (
        <img
          className={styles.portrait}
          src={slot.champion.image}
          alt={slot.champion.name}
        />
      ) : (
        <div
          className={`${styles.portrait} ${styles.portraitEmpty}`}
          role="img"
          aria-label="No champion selected"
        />
      )}
      <span
        className={`${styles.name} ${slot.pending || !slot.champion ? styles.namePending : ""}`}
      >
        {slot.champion?.name ?? "Picking…"}
      </span>
      {slot.isMine && slot.champion && onPickDirection ? (
        <div className={styles.directionPicker}>
          <div className={styles.directionPickerLabel}>Build direction</div>
          <BuildDirectionPicker
            value={playerDirection ?? null}
            onChange={onPickDirection}
            champion={slot.champion}
            size="compact"
          />
        </div>
      ) : null}
      {slot.isMine && slot.recommendedSpells ? (
        <div className={styles.spellImport}>
          {/* Key by the pair so the import status resets when the player's
              recommendation changes (e.g. hovering a different champion). */}
          <SpellImportAffordance
            key={slot.recommendedSpells.join("-")}
            spells={slot.recommendedSpells}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Wires the meta-recommended spell pair to the import status machine and the
 * presentational control. Lives at this level (not in `Slot`) so its hook runs
 * unconditionally, only mounted for the local player's slot when a pair exists.
 */
function SpellImportAffordance({ spells }: { spells: [number, number] }) {
  const { status, importSpells } = useSummonerSpellImport();
  return (
    <SummonerSpellImport
      spell1Id={spells[0]}
      spell2Id={spells[1]}
      status={status}
      onImport={() => importSpells(spells[0], spells[1])}
    />
  );
}
