import { useMemo } from "react";

import { mergeStyleMaps } from "./shared/styles/mergeStyleMaps";
import styles from "./App.module.scss";
import type { AppProps } from "./types";

/**
 * Root component of the application.
 *
 * Trivial on purpose: the harness is planted before the first line of real
 * code, and this exists so the whole chain - types, lint, format, tests, build
 * and the dev server - runs against something real from the first day. A chain
 * that has nothing to run on proves nothing.
 *
 * It is also the worked example of how this project styles a component, and
 * every component follows the same three steps:
 *
 *   1. the component imports its OWN module sheet and reads class names off it;
 *   2. a caller may hand in a class map, which is merged over the own one -
 *      optional, and rare in practice;
 *   3. the keys a caller may fill are declared in `types.ts`, which is the
 *      public restyling surface and nothing more.
 *
 * Replace it with the real root as soon as there is one, and name that one in
 * the map of the code instead. Keep the three steps.
 */
export function App({ className }: AppProps) {
  const classNames = useMemo(
    () => (className ? mergeStyleMaps(styles, className) : styles),
    [className],
  );

  return (
    <main className={classNames.app}>
      <h1 className={classNames.heading}>It works</h1>
    </main>
  );
}
