import { useState } from "react";
import type { LoadedGameData } from "../lib/data-ingest";
import { ChampionList } from "./ChampionList";
import { ItemList } from "./ItemList";
import { RuneList } from "./RuneList";
import { AugmentList } from "./AugmentList";
import { EntitySearch } from "./EntitySearch";

type Tab = "champions" | "items" | "runes" | "augments" | "search";

interface DataBrowserProps {
  data: LoadedGameData;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "champions", label: "Champions" },
  { key: "items", label: "Items" },
  { key: "runes", label: "Runes" },
  { key: "augments", label: "Augments" },
  { key: "search", label: "Search" },
];

export function DataBrowser({ data }: DataBrowserProps) {
  const [activeTab, setActiveTab] = useState<Tab>("champions");

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
            {tab.key !== "search" && (
              <span className="count">{getCount(data, tab.key)}</span>
            )}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {activeTab === "champions" && (
          <ChampionList champions={data.champions} />
        )}
        {activeTab === "items" && <ItemList items={data.items} />}
        {activeTab === "runes" && <RuneList runes={data.runes} />}
        {activeTab === "augments" && <AugmentList augments={data.augments} />}
        {activeTab === "search" && (
          <EntitySearch dictionary={data.dictionary} />
        )}
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
