type StyleMap = Record<string, string>;

// See ./README.md
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

  // Keys come from the inputs at run time; the compiler cannot see them.
  return result as T;
}
