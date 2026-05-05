import type { LoadedGameData } from "../lib/data-ingest";
import type { Champion } from "../lib/data-ingest/types";
import { useLiveGameState } from "../hooks/useLiveGameState";
import { resolveChampionName } from "../lib/data-ingest/champion-id-map";
import styles from "./ChampSelectSurface.module.css";

interface ChampSelectSurfaceProps {
  data: LoadedGameData;
}

interface RawChampSelectMember {
  cellId?: number;
  championId?: number;
  championPickIntent?: number;
}

interface RawChampSelectSession {
  localPlayerCellId?: number;
  myTeam?: RawChampSelectMember[];
  theirTeam?: RawChampSelectMember[];
}

interface SlotData {
  champion: Champion | undefined;
  isMine: boolean;
  pending: boolean;
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
  const session = liveGame.champSelect as RawChampSelectSession | null;

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
            <Slot key={`ally-${i}`} slot={slot} />
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
  return {
    champion,
    isMine: member.cellId === localCellId,
    pending: id > 0 && locked === 0,
  };
}

function Slot({ slot }: { slot: SlotData }) {
  const tag = slot.champion ? primaryTag(slot.champion.tags) : null;
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
        <div className={`${styles.portrait} ${styles.portraitEmpty}`} />
      )}
      <span
        className={`${styles.name} ${slot.pending || !slot.champion ? styles.namePending : ""}`}
      >
        {slot.champion?.name ?? "Picking…"}
      </span>
      <span
        className={`${styles.classTag} ${tag ? tagClass(tag) : styles.tagUnknown}`}
      >
        {tag ?? "—"}
      </span>
    </div>
  );
}

/**
 * Pick the single class tag for the slot label. DDragon returns multi-tag
 * arrays ordered primary-first (Malphite is ["Tank","Mage"], Lux is
 * ["Mage","Support"]) and the redesign asks for one badge per slot, so we
 * trust Riot's ordering. An earlier priority-list approach overrode that
 * ordering and labeled tank/mage hybrids like Malphite as "AP", which
 * misrepresented the player's typical build intent.
 */
function primaryTag(tags: string[]): string | null {
  return tags[0] ? tagToLabel(tags[0]) : null;
}

function tagToLabel(tag: string): string {
  switch (tag) {
    case "Marksman":
    case "Fighter":
    case "Assassin":
      return "AD";
    case "Mage":
      return "AP";
    case "Tank":
      return "Tank";
    case "Support":
      return "Supp";
    default:
      return tag;
  }
}

function tagClass(label: string): string {
  switch (label) {
    case "AD":
      return styles.tagAd;
    case "AP":
      return styles.tagAp;
    case "Tank":
      return styles.tagTank;
    case "Supp":
      return styles.tagSupp;
    default:
      return styles.tagUnknown;
  }
}
