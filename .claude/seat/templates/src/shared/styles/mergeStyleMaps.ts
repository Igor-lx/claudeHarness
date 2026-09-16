// See ./README.md
type StyleMap = Record<string, string>;

/**
 * Overlay caller-supplied class names on top of a component's own module map.
 *
 * The component keeps its own classes and gains the caller's, per key, instead
 * of choosing between them: dropping its own would take the layout with it,
 * and dropping the caller's would make the `className` prop a lie.
 *
 * Whether the caller's rule actually wins is decided by the cascade, not here -
 * see the layer order in `src/globals.scss`.
 */
export function mergeStyleMaps<T extends StyleMap>(
  ...maps: (Partial<T> | null | undefined)[]
): T {
  const result: StyleMap = {};

  for (const map of maps) {
    if (!map) continue;
    for (const key in map) {
      const value = map[key];
      if (!value) continue;
      result[key] = result[key] ? `${result[key]} ${value}` : value;
    }
  }

  return result as T;
}
