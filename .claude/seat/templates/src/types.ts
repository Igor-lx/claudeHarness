/**
 * Public restyling surface of the root component.
 *
 * The named keys are the contract: a caller may hand in a class for each of
 * them and nothing else is promised. The index signature is what lets a whole
 * CSS-module map be passed without casting - a module carries every class of
 * its sheet, including ones this component never reads.
 *
 * Both halves matter. Without the named keys the contract says nothing and any
 * typo passes; without the index signature every caller has to narrow its own
 * module map by hand.
 *
 * These names are written here AND in `App.module.scss` - the same value in two
 * languages, which the compiler cannot reconcile on its own. That duplication
 * is held by the check "Имена классов из кода есть в листе стилей"; see the
 * second kind of `C7-бис` in the quality policy for why it is a check here and
 * not a construction.
 */
export interface AppClassMap {
  [key: string]: string | undefined;
  app?: string;
  heading?: string;
}

export interface AppProps {
  className?: AppClassMap;
}
