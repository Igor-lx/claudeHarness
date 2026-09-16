/**
 * Root component of the application.
 *
 * Trivial on purpose: the harness is planted before the first line of real
 * code, and this exists so the whole chain - types, lint, format, tests, build
 * and the dev server - runs against something real from the first day. A chain
 * that has nothing to run on proves nothing.
 *
 * Replace it with the real root as soon as there is one, and name that one in
 * the map of the code instead.
 */
export function App() {
  return <h1>It works</h1>;
}
