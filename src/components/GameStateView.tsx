import type { EffectiveGameState, EffectivePlayer } from "../lib/mode";
import type { Augment, AramOverrides } from "../lib/data-ingest/types";
import { checkAugmentAvailability } from "../lib/mode/augment-availability";
import { AugmentSlots } from "./AugmentSlots";

interface AugmentSelectionActions {
  selectedAugments: Augment[];
  select: (augment: Augment) => void;
  removeLast: () => void;
  reset: () => void;
}

interface GameStateViewProps {
  state: EffectiveGameState;
  modeAugments?: Map<string, Augment>;
  augmentSelection: AugmentSelectionActions;
}

export function GameStateView({
  state,
  modeAugments,
  augmentSelection,
}: GameStateViewProps) {
  if (state.status === "disconnected") {
    return (
      <div className="game-status">
        <p className="game-status-label disconnected">No game detected</p>
        <p className="entity-meta">
          Start a game (or Practice Tool) to see live data.
        </p>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="game-status">
        <p className="game-status-label loading">Game loading...</p>
        <p className="entity-meta">Waiting for the game to finish loading.</p>
      </div>
    );
  }

  const minutes = Math.floor(state.gameTime / 60);
  const seconds = Math.floor(state.gameTime % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const active = state.activePlayer;
  const modeCtx = state.modeContext;

  return (
    <div>
      <div className="game-status">
        <p className="game-status-label connected">
          {modeCtx ? modeCtx.mode.displayName : state.gameMode} | {timeStr}
        </p>
      </div>

      {active && (
        <div className="active-player-card">
          <div className="entity-header">
            <span className="entity-name">
              {active.championName} (You)
              {active.tags.length > 0 && (
                <span className="player-tags">{active.tags.join(", ")}</span>
              )}
            </span>
            <span className="entity-meta">
              Lv{active.level} | {Math.floor(active.currentGold ?? 0)}g
            </span>
          </div>
          <div className="entity-details">
            {active.stats && (
              <div className="stat-grid">
                <span>
                  HP: {Math.floor(active.stats.currentHealth)}/
                  {Math.floor(active.stats.maxHealth)}
                </span>
                <span>AD: {Math.floor(active.stats.attackDamage)}</span>
                <span>AP: {Math.floor(active.stats.abilityPower)}</span>
                <span>Armor: {Math.floor(active.stats.armor)}</span>
                <span>MR: {Math.floor(active.stats.magicResist)}</span>
                <span>AS: {active.stats.attackSpeed.toFixed(2)}</span>
                <span>AH: {Math.floor(active.stats.abilityHaste)}</span>
                <span>MS: {Math.floor(active.stats.moveSpeed)}</span>
              </div>
            )}
            {active.runes && (
              <p className="entity-meta">
                {active.runes.keystone} ({active.runes.primaryTree} /{" "}
                {active.runes.secondaryTree})
              </p>
            )}
            <BalanceOverridesView overrides={active.balanceOverrides} />
          </div>
        </div>
      )}

      {modeCtx && (
        <div className="team-comp-summary">
          <div className="team-comp-row">
            <span className="entity-title">Allies:</span>
            <span className="entity-meta">
              {formatClassCounts(modeCtx.allyTeamComp.classCounts)}
            </span>
          </div>
          <div className="team-comp-row">
            <span className="entity-title">Enemies:</span>
            <span className="entity-meta">
              {formatClassCounts(modeCtx.enemyTeamComp.classCounts)}
            </span>
          </div>
        </div>
      )}

      <TeamsGrid allies={state.allies} enemies={state.enemies} />

      {modeAugments && modeAugments.size > 0 && (
        <AugmentSlots
          selectedAugments={augmentSelection.selectedAugments}
          availableAugments={modeAugments}
          availability={
            modeCtx && active
              ? checkAugmentAvailability(
                  active.level,
                  augmentSelection.selectedAugments.length,
                  modeCtx.mode
                )
              : undefined
          }
          onSelect={augmentSelection.select}
          onRemoveLast={augmentSelection.removeLast}
          onReset={augmentSelection.reset}
        />
      )}
    </div>
  );
}

function TeamsGrid({
  allies,
  enemies,
}: {
  allies: EffectivePlayer[];
  enemies: EffectivePlayer[];
}) {
  const maxRows = Math.max(allies.length, enemies.length);
  if (maxRows === 0) return null;

  return (
    <div className="teams-grid">
      <p className="entity-title">Your Team</p>
      <p className="entity-title">Enemy Team</p>
      {Array.from({ length: maxRows }, (_, i) => (
        <PlayerRow key={i} ally={allies[i]} enemy={enemies[i]} />
      ))}
    </div>
  );
}

function PlayerRow({
  ally,
  enemy,
}: {
  ally?: EffectivePlayer;
  enemy?: EffectivePlayer;
}) {
  return (
    <>
      <div className="team-cell">{ally && <PlayerCard player={ally} />}</div>
      <div className="team-cell">{enemy && <PlayerCard player={enemy} />}</div>
    </>
  );
}

function PlayerCard({ player: p }: { player: EffectivePlayer }) {
  return (
    <div className={`entity-item${p.isActivePlayer ? " active-player" : ""}`}>
      <div className="entity-header">
        <span className="entity-name">
          {p.championName}
          {p.isActivePlayer && " (You)"}
          {p.position && p.position !== "none" && (
            <span className="player-position">
              {formatPosition(p.position)}
            </span>
          )}
          {p.tags.length > 0 && (
            <span className="player-tags">{p.tags.join(", ")}</span>
          )}
        </span>
        <span className="entity-meta">
          Lv{p.level} | {p.kills}/{p.deaths}/{p.assists}
        </span>
      </div>
      <div className="player-items">
        {p.items.length > 0 ? (
          p.items.map((item, idx) => (
            <span
              key={`${p.riotIdGameName}-${item.id}-${idx}`}
              className="player-item"
            >
              {item.name}
            </span>
          ))
        ) : (
          <span className="entity-meta">No items</span>
        )}
      </div>
      <BalanceOverridesView overrides={p.balanceOverrides} />
    </div>
  );
}

function BalanceOverridesView({
  overrides,
}: {
  overrides: AramOverrides | null;
}) {
  if (!overrides) return null;
  if (!hasNonNeutralOverrides(overrides)) return null;

  return (
    <div className="aram-overrides">
      {overrides.dmgDealt !== 1 && (
        <span className="override-badge">
          Dmg {formatModifier(overrides.dmgDealt)}
        </span>
      )}
      {overrides.dmgTaken !== 1 && (
        <span className="override-badge">
          Taken {formatModifier(overrides.dmgTaken)}
        </span>
      )}
      {overrides.healing != null && overrides.healing !== 1 && (
        <span className="override-badge">
          Heal {formatModifier(overrides.healing)}
        </span>
      )}
      {overrides.shielding != null && overrides.shielding !== 1 && (
        <span className="override-badge">
          Shield {formatModifier(overrides.shielding)}
        </span>
      )}
      {overrides.tenacity != null && overrides.tenacity !== 1 && (
        <span className="override-badge">
          Tenacity {formatModifier(overrides.tenacity)}
        </span>
      )}
      {overrides.energyRegenMod != null && overrides.energyRegenMod !== 1 && (
        <span className="override-badge">
          Energy {formatModifier(overrides.energyRegenMod)}
        </span>
      )}
      {overrides.totalAs != null && overrides.totalAs !== 1 && (
        <span className="override-badge">
          AS {formatModifier(overrides.totalAs)}
        </span>
      )}
      {overrides.abilityHaste != null && overrides.abilityHaste !== 0 && (
        <span className="override-badge">AH +{overrides.abilityHaste}</span>
      )}
    </div>
  );
}

function hasNonNeutralOverrides(o: AramOverrides): boolean {
  return (
    o.dmgDealt !== 1 ||
    o.dmgTaken !== 1 ||
    (o.healing != null && o.healing !== 1) ||
    (o.shielding != null && o.shielding !== 1) ||
    (o.tenacity != null && o.tenacity !== 1) ||
    (o.energyRegenMod != null && o.energyRegenMod !== 1) ||
    (o.totalAs != null && o.totalAs !== 1) ||
    (o.abilityHaste != null && o.abilityHaste !== 0)
  );
}

function formatModifier(value: number): string {
  const pct = Math.round((value - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

const POSITION_LABELS: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

function formatPosition(position: string): string {
  return POSITION_LABELS[position] ?? position;
}

function formatClassCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return "—";
  return entries.map(([cls, n]) => `${n} ${cls}`).join(", ");
}
