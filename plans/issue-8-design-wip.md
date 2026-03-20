# Issue #8 Design — ARAM Mayhem Mode Module

## Status: Design complete, ready for implementation

## Decisions made

### Separation of concerns

- `GameState` stays as a clean normalized view of the Riot API
- `ModeContext` is a separate object produced by the mode module
- An `EffectiveGameState` composition layer merges the two so consumers get one unified view
- Consumers use the composed view 95% of the time; raw pieces available for debugging

### Mode interface

```typescript
interface GameMode {
  id: string; // "aram-mayhem", "arena", "aram", "sr"
  displayName: string; // "ARAM Mayhem"
  decisionTypes: DecisionType[]; // what users can ask about in this mode
  matches(gameMode: string): boolean; // does this raw API gameMode string belong to us?
  buildContext(gameState: GameState, gameData: LoadedGameData): ModeContext;
}

type DecisionType =
  | "augment-selection"
  | "item-purchase"
  | "open-ended-coaching";
```

- `DecisionType` represents user-initiated questions only
- Engine-initiated behaviors (build pivot detection, augment set tracking) are emergent from the recommendation engine doing its job, not declared per mode
- `matches()` takes the raw `gameMode` string from the Riot API
- `buildContext()` is a pure function — no side effects, easy to test

### ModeContext type

```typescript
interface ModeContext {
  mode: GameMode;
  playerContexts: Map<string, PlayerModeContext>;
  modeItems: Map<number, Item>;
  modeAugments: Map<string, Augment>;
  augmentSets: AugmentSet[];
  allyTeamComp: TeamComposition;
  enemyTeamComp: TeamComposition;
}

interface PlayerModeContext {
  championName: string;
  team: "ORDER" | "CHAOS";
  tags: string[]; // ["Mage", "Support"] from champion data
  balanceOverrides: AramOverrides | null;
  selectedAugments: Augment[]; // from voice input, active player only
  setProgress: SetProgress[]; // derived from selectedAugments
}

interface AugmentSet {
  name: string;
  augments: string[];
  bonuses: AugmentSetBonus[];
}

interface SetProgress {
  set: AugmentSet;
  count: number;
  nextBonus: AugmentSetBonus | null;
}

interface TeamComposition {
  players: PlayerModeContext[];
  classCounts: Record<string, number>; // { "Assassin": 2, "Tank": 1, ... }
}
```

### What ModeContext contains for ARAM Mayhem

1. ARAM balance overrides for ALL players (not just active)
2. Mode-filtered augments (Mayhem augments only)
3. Mode-filtered items (ARAM variant items, 320000-329999 range)
4. Champion tags/class for all players
5. Decision types: augment-selection, item-purchase, open-ended-coaching
6. Augment set definitions and progress tracking
7. Team composition analysis (aggregated class counts per team)

### EffectiveGameState composition layer

```typescript
interface EffectiveGameState {
  raw: GameState;
  modeContext: ModeContext | null;
  status: ConnectionStatus;
  gameMode: string;
  gameTime: number;
  activePlayer: EffectivePlayer | null;
  allies: EffectivePlayer[];
  enemies: EffectivePlayer[];
}

interface EffectivePlayer {
  championName: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  items: PlayerItem[];
  summonerSpells: [string, string];
  riotIdGameName: string;
  isActivePlayer: boolean;
  tags: string[];
  balanceOverrides: AramOverrides | null;
  currentGold?: number;
  runes?: ActivePlayerRunes;
  stats?: ActivePlayerStats;
  selectedAugments?: Augment[];
  setProgress?: SetProgress[];
}
```

- Players pre-split into allies/enemies because every downstream consumer needs them separated
- EffectivePlayer flattens GameState + ModeContext per player so consumers never cross-reference two maps
- Built by a pure function `buildEffectiveGameState(gameState, modeContext)` called on every state update

### Mode registry

```typescript
interface ModeRegistry {
  register(mode: GameMode): void;
  detect(gameMode: string): GameMode | null;
}
```

- Simple array of registered modes, iterated in order calling `mode.matches(gameMode)`
- Returns null for unknown/unsupported modes (app still works, just no enrichments)
- Avoids a switch statement in core code — adding a mode means registering a new module, not editing existing files

### Shell UI changes

- GameStateView receives EffectiveGameState instead of raw GameState
- Mode-specific sections render when modeContext is non-null
- Shows: detected mode name, balance overrides per player, selected augments, set progress, team comp summaries
- Kept in existing GameStateView component (mode context is tightly coupled to player data it enriches)

### DPI and layout fixes

- Remove `max-width: 900px` centering constraint — use full viewport width with responsive padding
- Use rem-based sizing with viewport-responsive root font size for readable defaults across DPI
- Enable WebView2 zoom (Ctrl+/Ctrl-) via Tauri's zoom API for user fine-tuning
- Both needed: CSS handles the default, zoom handles personal preference

## Implementation order

1. Types (mode interface, ModeContext, EffectiveGameState, EffectivePlayer)
2. Mode registry (register, detect)
3. ARAM Mayhem mode module (matches, buildContext)
4. EffectiveGameState builder (pure function, merges GameState + ModeContext)
5. Hook into GameStateManager (detect mode on connect, rebuild effective state on update)
6. DPI/layout CSS fixes
7. WebView2 zoom support
8. Update GameStateView to render EffectiveGameState with mode-specific sections
