type StyleMap = Record<string, string>;

// See ./README.md
export function mergeStyleMaps<T extends StyleMap>(
  ...maps: (Partial<T> | null | undefined)[]
): T {
  const result: StyleMap = {};

  for (const map of maps) {
    for (const [key, value] of Object.entries<string | undefined>(map ?? {})) {
      if (!value) continue;
      result[key] = result[key] ? `${result[key]} ${value}` : value;
    }
  }

  return result as T; // keys come from the inputs at run time; the compiler cannot see them
}
