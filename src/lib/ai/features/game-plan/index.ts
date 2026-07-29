import type { CoachingFeature } from "../../feature";
import type { BuildPathItem } from "../../types";
import type { LoadedGameData } from "../../../data-ingest";
import type { Item } from "../../../data-ingest/types";
import type { GameMode } from "../../../mode/types";
import { formatStateSnapshot, type GameSnapshot } from "../../state-formatter";
import { isBuildPathEligible, resolveToPurchasable } from "../../item-catalog";
import { GAME_PLAN_TASK_PROMPT } from "./prompt";
import { createGamePlanSchema, type GamePlanResult } from "./schema";

export type { GamePlanResult } from "./schema";

export interface GamePlanInput {
  readonly snapshot: GameSnapshot | null;
}

/**
 * The game-plan user message.
 *
 * State-agnostic by design: the same prompt serves the auto-fired opening
 * plan AND the mid-game "update plan" voice command. The [Game State] block
 * that precedes this message carries every temporal input the LLM needs
 * (current items, game time, enemy itemization, KDA).
 *
 * Instructs the LLM to return its 6-item build path in the structured
 * `buildPath` field with per-item category + reason (not in
 * `recommendations`), so the UI can render category icons and
 * counter-target associations (#99).
 */
export function buildGamePlanQuestion(): string {
  return [
    "Based on the current game state — my champion, current inventory, the enemy team composition and their itemization, my chosen augments, and the game mode — give me my game plan: what to watch out for, who to focus, and my recommended 6-item build path in order.",
    "",
    "The 6-item buildPath represents my END-STATE inventory. Items I already own MUST appear in the buildPath using their exact name from the Item Catalog, in the position they belong in the end-state build. Recommend new items only for the slots that aren't already filled by what I own. Never suggest a 7th item — the inventory cap is 6 total, including items I already have.",
    "",
    "Return the 6 items in the `buildPath` field of your response. For each item:",
    "- name: exact item name from the Item Catalog.",
    "- category: one of core | counter | defensive | damage | utility | situational.",
    "- targetEnemy: the enemy champion name being countered when category is `counter`; set to `null` for every other category (the field must always be present — the schema is nullable, not optional).",
    "- reason: a few words max. Sacrifice grammar for brevity. No full sentences.",
    "",
    "Category definitions:",
    "- core: fundamental to the champion's kit; built regardless of matchup.",
    "- counter: directly addresses one specific enemy champion's threat.",
    "- defensive: survivability against the enemy comp broadly (not one specific champion).",
    "- damage: amplifies damage beyond core items.",
    "- utility: team support, CC, healing, or vision.",
    "- situational: escape hatch for anything that doesn't fit the others. Use rarely.",
  ].join("\n");
}

/**
 * Voice-command trigger for mid-game plan refresh.
 *
 * Detection is intent-based, not start-anchored. Players phrase the command
 * naturally and mid-sentence ("you should update the game plan", "these are
 * wrong, update the plan", "I think you should update gameplay"), so the old
 * `^`-anchored matcher silently dropped real commands. Two parts:
 *
 * 1. **Command, matched anywhere.** A command verb (update / refresh / rework /
 *    redo / replace / remake, plus their `-ing` forms) followed by an optional
 *    article and the plan target. "plan", "game plan", Whisper's one-word
 *    "gameplan" (`game\s*plan`), and its mishearing "gameplay" all count. Bare
 *    "plan" without a command verb stays inert, so commentary like "that's a
 *    new plan" or "the plan is working" does not fire.
 * 2. **Deliberative guard.** Reject self-directed questions where the player is
 *    weighing whether to update rather than commanding it ("should I update my
 *    plan?", "do you think I should update the plan?"). These must fall through
 *    to a coaching answer instead of silently regenerating the plan. The guard
 *    keys on a first-person subject ("should I", "do we", "I should"), so
 *    coach-directed requests ("you should update...", "can you update...") still
 *    fire.
 *
 * Known limitation: embedded negation ("don't update the plan", "I don't think
 * you should") is not detected and will fire. It is rare in live voice;
 * detecting it robustly is the intent-classifier path we deliberately skipped.
 */
const UPDATE_VERB =
  "(?:update|updating|refresh|refreshing|rework|reworking|redo|redoing|replace|replacing|remake|remaking)";

const UPDATE_PLAN_COMMAND = new RegExp(
  `\\b${UPDATE_VERB}\\s+(?:(?:the|my|our|your)\\s+)?(?:game\\s*)?(?:plan|gameplay)\\b`,
  "i"
);

const DELIBERATIVE_QUESTION =
  /\b(?:should|shall|can|could|would|will|do|does|did)\s+(?:i|we)\b|\b(?:i|we)\s+should\b/i;

export function isUpdatePlanCommand(text: string): boolean {
  const trimmed = text.trim();
  if (DELIBERATIVE_QUESTION.test(trimmed)) return false;
  return UPDATE_PLAN_COMMAND.test(trimmed);
}

/**
 * Factory for the game-plan feature. Binds the output schema's `buildPath[].name`
 * enum to the items that are build-path-eligible in the current mode, via the
 * shared `isBuildPathEligible` predicate (completed, purchasable, non-consumable,
 * mode-available). This re-enables name validation (#109) and structurally rules
 * out consumables and off-catalog entries (#127).
 *
 * Two things this deliberately does NOT do, because they are not expressible as
 * a per-element enum and belong to post-hoc validation (#117): cross-item
 * legality (one boots, no duplicate Legendary, mutually exclusive item groups)
 * and excluding items the player already owns.
 *
 * Why not the raw catalog or `filterItemsByMode`: the full catalog (~648 items)
 * exceeds the schema's 500-value enum cap and silently disables the enum, while
 * `filterItemsByMode(items, "aram")` returns only the ~21 ARAM-exclusive
 * variants (ID-range partition, not "usable in ARAM") and cornered the model
 * into a Winter's Approach x6 build. `isBuildPathEligible` accepts standard plus
 * ARAM-variant items, ~150-200 names, comfortably under the cap.
 */
export function createGamePlanFeature(
  gameData: LoadedGameData,
  mode: GameMode
): CoachingFeature<GamePlanInput, GamePlanResult> {
  // Dedupe by name: in ARAM a standard item and its ARAM variant are both
  // eligible and share a name, so the raw list carries ~21 duplicate names.
  const itemNames = [
    ...new Set(
      Array.from(gameData.items.values())
        .filter((item) => isBuildPathEligible(item, mode))
        .map((i) => i.name)
    ),
  ];
  const schema = createGamePlanSchema(itemNames);

  return {
    id: "game-plan",
    supportedPhases: ["in-game"] as const,

    buildTaskPrompt: () => `\n\n${GAME_PLAN_TASK_PROMPT}`,

    buildUserMessage: ({ snapshot }) => {
      const snapshotText = snapshot
        ? formatStateSnapshot(snapshot, { omitAugments: true })
        : "";
      return `[Game State]\n${snapshotText}\n\n[Question]\n${buildGamePlanQuestion()}`;
    },

    outputSchema: schema,

    extractResult: (raw) => raw,

    summarizeForHistory: (result) => result.answer,
  };
}

/**
 * Permissive shape for `extractBuildPath` callers.
 *
 * The current schema produces `GamePlanResult` directly, but this helper
 * also accepts the legacy `CoachingResponse` shape where `buildPath` is
 * nullable and the model occasionally placed items in `recommendations`
 * instead. Both fields are optional so either source can satisfy it.
 */
export interface GamePlanResultLike {
  buildPath?: BuildPathItem[] | null;
  recommendations?: Array<{ name: string; reasoning: string }>;
}

/**
 * Normalize a game-plan result's build path. Today the schema requires
 * exactly 6 items and enum-locks names to the catalog; `extractBuildPath`
 * preserves the historical fallback of promoting recommendations when
 * `buildPath` somehow comes back empty (degraded mode when enum can't be
 * applied due to size, or legacy compatibility with the old shared-schema
 * response shape).
 */
export function extractBuildPath(result: GamePlanResultLike): BuildPathItem[] {
  if (result.buildPath && result.buildPath.length > 0) {
    return result.buildPath;
  }
  return (result.recommendations ?? []).map((r) => ({
    name: r.name,
    category: "core" as const,
    targetEnemy: null,
    reason: r.reasoning,
  }));
}

/** A build-path entry removed because its restriction group is already
 *  occupied, either by an earlier path entry or by an item the player
 *  already owns. */
export interface MutexCollisionDrop {
  kind: "mutex-collision";
  /** The entry removed from the build path. */
  entry: BuildPathItem;
  /** The restriction group both items share (e.g. "Fatality"). */
  group: string;
  /** The item name holding the group's single legal slot. For an
   *  inventory-held slot this is the player's actual item name (e.g.
   *  "Muramana"), which may differ from the purchasable base. */
  keptName: string;
  /** Where the slot-holder lives: an earlier kept path entry, or the
   *  player's current inventory. */
  keptSource: "path" | "inventory";
}

/** A build-path entry removed because its name already appears earlier in
 *  the surfaced path (including the single allowed appearance of an item
 *  the player already owns). */
export interface DuplicateNameDrop {
  kind: "duplicate-name";
  /** The entry removed from the build path. */
  entry: BuildPathItem;
}

/** A build-path entry removed because no catalog item with its name is
 *  purchasable in the current game mode (e.g. an Arena-only or
 *  Nexus-Blitz-only item recommended in Classic or ARAM). */
export interface ModeUnavailableDrop {
  kind: "mode-unavailable";
  /** The entry removed from the build path. */
  entry: BuildPathItem;
  /** Display name of the mode the item is unavailable in, for logs. */
  modeName: string;
}

/** A build-path entry removed because the single boots slot is already
 *  occupied, either by an earlier path entry or by a Boots item the player
 *  already owns (the shop refuses a second pair). */
export interface BootsCollisionDrop {
  kind: "boots-collision";
  /** The entry removed from the build path. */
  entry: BuildPathItem;
  /** The item name holding the single boots slot. */
  keptName: string;
  /** Where the slot-holder lives: an earlier kept path entry, or the
   *  player's current inventory. */
  keptSource: "path" | "inventory";
}

export type BuildPathDrop =
  | MutexCollisionDrop
  | DuplicateNameDrop
  | ModeUnavailableDrop
  | BootsCollisionDrop;

export interface BuildPathLegalityResult {
  /** The build path with every illegal entry removed. */
  buildPath: BuildPathItem[];
  /** Entries dropped, in build-path order. Empty when the path was legal. */
  dropped: BuildPathDrop[];
}

/** Which side of the sweep currently holds a name or group slot. */
type SlotSource = "path" | "inventory";

/**
 * Deterministic post-hoc enforcement of build-path purchase legality
 * (issue #117): mutually exclusive item groups, duplicate item names, boots
 * uniqueness, mode availability, and the player's current inventory, in one
 * first-entry-wins sweep. A schema enum cannot express any of these
 * cross-item constraints, so the prompt carries the primary rules and this
 * sweep guarantees them.
 *
 * Rules, in the order each entry is checked:
 *
 * 1. **One copy per name.** The path is a 6-slot END-STATE inventory of
 *    finished items, so no name may appear twice. Name equality needs no
 *    catalog proof, which also covers degraded free-string mode.
 * 2. **End-state echo of owned items.** The game-plan question REQUIRES
 *    owned items to reappear once in their end-state slot, so an owned
 *    name's first path appearance is kept (and consumes the name's slot);
 *    only a second appearance is a duplicate. An owned evolved item
 *    (Muramana) counts as its purchasable base (Manamune) via the
 *    `specialRecipe` walk, because the base name is the only form the
 *    catalog enum lets the model echo.
 * 3. **Mode availability.** An entry is mode-legal only when SOME catalog
 *    item with its name is `isBuildPathEligible` for the current mode. The
 *    "some" quantifier is essential: duplicate names span ID partitions
 *    (Abyssal Mask is both standard 8020 and aram-band 328020), and the
 *    wrong variant must not cause a false drop. Owned echoes are exempt
 *    (rule 2 keeps them before this check runs): what the player already
 *    holds is a fact of the game, not a recommendation.
 * 4. **At most one Boots item (#109).** Boots are NOT a wiki itemlimit
 *    group, so this rule is tag-based: a name is a boots item when ANY
 *    same-named catalog variant carries the "Boots" tag (the same
 *    any-variant quantifier as rule 3). An owned Boots item occupies the
 *    slot before the sweep (the shop refuses a second pair); within the
 *    path, the first boots entry wins. Owned echoes are exempt via rule 2.
 * 5. **One item per restriction group.** Groups occupied by owned items are
 *    seeded before the sweep (the shop blocks buying a sibling of an owned
 *    group member); within the path, build order is priority order, so the
 *    earlier of two colliding items keeps the slot.
 *
 * Entries and owned names the catalog cannot prove illegal are never
 * touched: unknown names carry no groups, no boots verdict, and no mode
 * verdict, and an unknown owned name only ever blocks an exact same-name
 * re-buy.
 */
export function enforceBuildPathLegality(
  buildPath: readonly BuildPathItem[],
  items: ReadonlyMap<number, Item>,
  mode: GameMode,
  ownedItemNames: readonly string[] = []
): BuildPathLegalityResult {
  // Union groups across same-named variants (an ARAM rebalance and its
  // standard item share a name and must carry the same restrictions), keep
  // one representative item per name for the specialRecipe walk, and record
  // which names have at least one mode-eligible variant.
  const groupsByName = new Map<string, Set<string>>();
  const itemByName = new Map<string, Item>();
  const modeLegalNames = new Set<string>();
  const bootsNames = new Set<string>();
  for (const item of items.values()) {
    if (!itemByName.has(item.name)) itemByName.set(item.name, item);
    if (isBuildPathEligible(item, mode)) modeLegalNames.add(item.name);
    if (item.tags.includes("Boots")) bootsNames.add(item.name);
    if (!item.mutexGroups || item.mutexGroups.length === 0) continue;
    const groups = groupsByName.get(item.name) ?? new Set<string>();
    for (const group of item.mutexGroups) groups.add(group);
    groupsByName.set(item.name, groups);
  }

  const nameSlots = new Map<string, SlotSource>();
  const groupSlots = new Map<string, { name: string; source: SlotSource }>();
  let bootsSlot: { name: string; source: SlotSource } | null = null;

  // Seed slots from the player's inventory. The owned display name (what the
  // playtest log should show, e.g. "Muramana") holds the group slots; both
  // the owned name and its purchasable base name (the only form the path can
  // echo) hold name slots.
  for (const ownedName of ownedItemNames) {
    const ownedItem = itemByName.get(ownedName);
    const base = ownedItem ? resolveToPurchasable(ownedItem, items) : null;
    const ownedNames =
      base && base.name !== ownedName ? [ownedName, base.name] : [ownedName];
    for (const name of ownedNames) {
      if (!nameSlots.has(name)) nameSlots.set(name, "inventory");
      if (bootsNames.has(name) && bootsSlot === null) {
        bootsSlot = { name: ownedName, source: "inventory" };
      }
      for (const group of groupsByName.get(name) ?? []) {
        if (!groupSlots.has(group)) {
          groupSlots.set(group, { name: ownedName, source: "inventory" });
        }
      }
    }
  }

  const kept: BuildPathItem[] = [];
  const dropped: BuildPathDrop[] = [];

  for (const entry of buildPath) {
    const nameSlot = nameSlots.get(entry.name);
    if (nameSlot === "path") {
      dropped.push({ kind: "duplicate-name", entry });
      continue;
    }
    if (nameSlot === "inventory") {
      // The end-state echo of an owned item: legal exactly once. Its groups
      // are already seeded by the same owned item, so no group check. Also
      // deliberately ahead of the mode check: an owned item is a fact of
      // the game and its echo is never dropped for mode reasons.
      nameSlots.set(entry.name, "path");
      kept.push(entry);
      continue;
    }

    // Known name with no mode-eligible variant: not buyable in this mode.
    // Unknown names fall through untouched (nothing proven).
    if (itemByName.has(entry.name) && !modeLegalNames.has(entry.name)) {
      dropped.push({
        kind: "mode-unavailable",
        entry,
        modeName: mode.displayName,
      });
      continue;
    }

    if (bootsNames.has(entry.name) && bootsSlot !== null) {
      dropped.push({
        kind: "boots-collision",
        entry,
        keptName: bootsSlot.name,
        keptSource: bootsSlot.source,
      });
      continue;
    }

    const groups = groupsByName.get(entry.name);
    let collision: Omit<MutexCollisionDrop, "kind" | "entry"> | null = null;
    for (const group of groups ?? []) {
      const slot = groupSlots.get(group);
      if (slot !== undefined) {
        collision = { group, keptName: slot.name, keptSource: slot.source };
        break;
      }
    }
    if (collision) {
      dropped.push({ kind: "mutex-collision", entry, ...collision });
      continue;
    }

    nameSlots.set(entry.name, "path");
    if (bootsNames.has(entry.name) && bootsSlot === null) {
      bootsSlot = { name: entry.name, source: "path" };
    }
    for (const group of groups ?? []) {
      groupSlots.set(group, { name: entry.name, source: "path" });
    }
    kept.push(entry);
  }

  return { buildPath: kept, dropped };
}

/**
 * One drop as a human-readable log fragment. The remediation warn line is
 * the primary debugging surface in playtest logs, so each fragment names the
 * dropped item and exactly why it lost its slot.
 */
export function describeBuildPathDrop(drop: BuildPathDrop): string {
  switch (drop.kind) {
    case "duplicate-name":
      return `${drop.entry.name} (duplicate of an earlier build-path entry)`;
    case "mutex-collision":
      return drop.keptSource === "inventory"
        ? `${drop.entry.name} (group ${drop.group}, player owns ${drop.keptName})`
        : `${drop.entry.name} (group ${drop.group}, kept ${drop.keptName})`;
    case "mode-unavailable":
      return `${drop.entry.name} (not purchasable in ${drop.modeName})`;
    case "boots-collision":
      return drop.keptSource === "inventory"
        ? `${drop.entry.name} (second boots, player owns ${drop.keptName})`
        : `${drop.entry.name} (second boots, kept ${drop.keptName})`;
  }
}
