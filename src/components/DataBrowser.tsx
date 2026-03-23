import { useState } from "react";
import type { Augment } from "../lib/data-ingest/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { EffectiveGameState } from "../lib/mode";
import { ChampionList } from "./ChampionList";
import { ItemList } from "./ItemList";
import { RuneList } from "./RuneList";
import { AugmentList } from "./AugmentList";
import { EntitySearch } from "./EntitySearch";
import { GameStateView } from "./GameStateView";
import { DebugPanel } from "./DebugPanel";

type Tab =
  | "game"
  | "champions"
  | "items"
  | "runes"
  | "augments"
  | "search"
  | "debug";

interface AugmentSelectionActions {
  selectedAugments: Augment[];
  select: (augment: Augment) => void;
  removeLast: () => void;
  reset: () => void;
}

interface DataBrowserProps {
  data: LoadedGameData;
  effectiveState: EffectiveGameState;
  augmentSelection: AugmentSelectionActions;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "game", label: "Game" },
  { key: "champions", label: "Champions" },
  { key: "items", label: "Items" },
  { key: "runes", label: "Runes" },
  { key: "augments", label: "Augments" },
  { key: "search", label: "Search" },
  { key: "debug", label: "Debug" },
];

export function DataBrowser({
  data,
  effectiveState,
  augmentSelection,
}: DataBrowserProps) {
  const [activeTab, setActiveTab] = useState<Tab>("game");

  return (
    <>
      <div className="app-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? "tab active" : "tab"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.key === "game" && (
              <span className={`status-dot ${effectiveState.status}`} />
            )}
            {tab.key !== "search" && tab.key !== "game" && (
              <span className="count">{getCount(data, tab.key)}</span>
            )}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {activeTab === "game" && (
          <GameStateView
            state={effectiveState}
            modeAugments={effectiveState.modeContext?.modeAugments}
            augmentSelection={augmentSelection}
          />
        )}
        {activeTab === "champions" && (
          <ChampionList champions={data.champions} />
        )}
        {activeTab === "items" && <ItemList items={data.items} />}
        {activeTab === "runes" && <RuneList runes={data.runes} />}
        {activeTab === "augments" && <AugmentList augments={data.augments} />}
        {activeTab === "search" && <EntitySearch data={data} />}
        {activeTab === "debug" && <DebugPanel />}
      </div>
    </>
  );
}

function getCount(data: LoadedGameData, tab: Tab): number {
  switch (tab) {
    case "champions":
      return data.champions.size;
    case "items":
      return data.items.size;
    case "runes":
      return data.runes.reduce(
        (sum, tree) =>
          sum +
          tree.keystones.length +
          tree.slots.reduce((s, slot) => s + slot.length, 0),
        0
      );
    case "augments":
      return data.augments.size;
    default:
      return 0;
  }
}
