import type { LoadedGameData } from "../lib/data-ingest";
import type { GameLifecycleEvent, GameflowPhase } from "../lib/reactive/types";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { LastGameCard } from "../components/coaching";

interface IdleSurfaceProps {
  data: LoadedGameData;
  lifecycle: GameLifecycleEvent;
  lastPhase: GameflowPhase | null;
  championName: string | null;
}

/**
 * The home view shown when no game is in progress. Phase 1-4 hosts the
 * existing connection-status indicator and last-game card; Phase 5 will
 * replace this with the redesign's hero block, 3-stat strip, recent games
 * list, and pinned notes once match-history aggregation lands.
 */
export function IdleSurface({
  data,
  lifecycle,
  lastPhase,
  championName,
}: IdleSurfaceProps) {
  return (
    <div className="app-idle">
      <ConnectionStatus
        lifecycle={lifecycle}
        lastPhase={lastPhase}
        championName={championName}
      />
      <LastGameCard
        dataVersion={data.version}
        championCount={data.champions.size}
        itemCount={data.items.size}
        augmentCount={data.augments.size}
      />
    </div>
  );
}
