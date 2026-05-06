import type { LoadedGameData } from "../../lib/data-ingest";

export interface ItemIconProps {
  /** Item display name as it appears in DDragon. */
  name: string;
  /** Loaded DDragon data — provides the image URL. Null is allowed during boot. */
  gameData: LoadedGameData | null;
  /** Pixel size for both width and height. Defaults to 36. */
  size?: number;
  /** Optional class on the rendered <img>. */
  className?: string;
  /**
   * Hover-title text. Defaults to the item name. Pass `null` to suppress
   * the tooltip; pass a custom string for richer text (e.g. stat readout).
   */
  title?: string | null;
}

/**
 * Resolve an item name to its DDragon image URL via a linear scan of the
 * loaded items Map. The Map is keyed by numeric id so name lookup is the
 * shape we have to do here; the catalog is small (~200 entries) and call
 * sites render only a handful of icons at once, so this is cheap.
 */
function resolveItemUrl(
  name: string,
  gameData: LoadedGameData | null
): string | null {
  if (!gameData) return null;
  for (const item of gameData.items.values()) {
    if (item.name === name) return item.image;
  }
  return null;
}

/**
 * Reusable item-icon glyph. Renders the DDragon-resolved image with
 * a hover title. Returns null when the item can't be resolved (game
 * data not loaded yet, or the name doesn't appear in the catalog —
 * the caller decides whether to show a fallback).
 */
export function ItemIcon({
  name,
  gameData,
  size = 36,
  className,
  title,
}: ItemIconProps) {
  const url = resolveItemUrl(name, gameData);
  if (!url) return null;
  const tooltip = title === null ? undefined : (title ?? name);
  return (
    <img
      src={url}
      alt={name}
      title={tooltip}
      width={size}
      height={size}
      className={className}
      loading="lazy"
    />
  );
}
