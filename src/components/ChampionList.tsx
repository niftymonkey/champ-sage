import { useState } from "react";
import type { Champion, AramOverrides } from "../lib/data-ingest/types";

interface ChampionListProps {
  champions: Map<string, Champion>;
}

function formatModifier(value: number): string {
  const pct = Math.round((value - 1) * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function hasNonNeutralOverrides(aram: AramOverrides): boolean {
  return (
    aram.dmgDealt !== 1 ||
    aram.dmgTaken !== 1 ||
    aram.healing !== undefined ||
    aram.shielding !== undefined ||
    aram.tenacity !== undefined ||
    aram.energyRegenMod !== undefined ||
    aram.totalAs !== undefined ||
    aram.abilityHaste !== undefined
  );
}

export function ChampionList({ champions }: ChampionListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = [...champions.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div className="entity-list">
      {sorted.map((champ) => (
        <div key={champ.id} className="entity-item">
          <div
            className="entity-header"
            onClick={() => setExpanded(expanded === champ.id ? null : champ.id)}
          >
            <span className="entity-name">
              {champ.name}
              {champ.aramOverrides &&
                hasNonNeutralOverrides(champ.aramOverrides) && (
                  <span className="aram-badge">ARAM</span>
                )}
            </span>
            <span className="entity-meta">
              {champ.tags.join(", ")} | {champ.partype}
            </span>
          </div>
          {expanded === champ.id && (
            <div className="entity-details">
              <p className="entity-title">{champ.title}</p>
              <div className="stat-grid">
                <span>HP: {champ.stats.hp}</span>
                <span>AD: {champ.stats.attackdamage}</span>
                <span>Armor: {champ.stats.armor}</span>
                <span>MR: {champ.stats.spellblock}</span>
                <span>AS: {champ.stats.attackspeed}</span>
                <span>Range: {champ.stats.attackrange}</span>
                <span>MS: {champ.stats.movespeed}</span>
              </div>
              {champ.aramOverrides &&
                hasNonNeutralOverrides(champ.aramOverrides) && (
                  <div className="aram-overrides">
                    <p className="entity-title">ARAM Balance</p>
                    <div className="stat-grid">
                      {champ.aramOverrides.dmgDealt !== 1 && (
                        <span>
                          Dmg Dealt:{" "}
                          {formatModifier(champ.aramOverrides.dmgDealt)}
                        </span>
                      )}
                      {champ.aramOverrides.dmgTaken !== 1 && (
                        <span>
                          Dmg Taken:{" "}
                          {formatModifier(champ.aramOverrides.dmgTaken)}
                        </span>
                      )}
                      {champ.aramOverrides.healing !== undefined && (
                        <span>
                          Healing: {formatModifier(champ.aramOverrides.healing)}
                        </span>
                      )}
                      {champ.aramOverrides.shielding !== undefined && (
                        <span>
                          Shielding:{" "}
                          {formatModifier(champ.aramOverrides.shielding)}
                        </span>
                      )}
                      {champ.aramOverrides.tenacity !== undefined && (
                        <span>
                          Tenacity:{" "}
                          {formatModifier(champ.aramOverrides.tenacity)}
                        </span>
                      )}
                      {champ.aramOverrides.energyRegenMod !== undefined && (
                        <span>
                          Energy Regen:{" "}
                          {formatModifier(champ.aramOverrides.energyRegenMod)}
                        </span>
                      )}
                      {champ.aramOverrides.totalAs !== undefined && (
                        <span>
                          Atk Speed:{" "}
                          {formatModifier(champ.aramOverrides.totalAs)}
                        </span>
                      )}
                      {champ.aramOverrides.abilityHaste !== undefined && (
                        <span>
                          Ability Haste: +{champ.aramOverrides.abilityHaste}
                        </span>
                      )}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
