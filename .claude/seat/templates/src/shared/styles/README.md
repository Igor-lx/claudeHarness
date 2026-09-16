# styles

Style-map helpers, application-wide. Pure, dependency-free.

## API

- **`mergeStyleMaps(...maps)`** — combine several CSS-module maps by
  concatenating the class strings per key. Lets a component overlay
  caller-supplied class overrides on top of its own module map without losing
  the originals. Null and undefined maps, and empty values, are skipped.

## Why it lives here and not next to a component

Every component styles itself the same way, so the helper belongs to the
application, not to any one of them. A copy per component would be the same
function written several times, diverging at the first fix.

## Why merging alone is not enough

Merging puts both class names on the same element. Which rule then wins is a
specificity race whose outcome depends on bundle order — that is, on nothing
the author controls.

The project settles it with cascade layers instead: a component's own rules go
inside a layer, the caller's arrive unlayered, and unlayered styles beat every
layer regardless of specificity. So the layer wrapper in a component sheet is
load-bearing, not decoration: drop it and the promise of restyling quietly
turns back into a race it may lose.

The full scheme — what a component imports, what it declares, and what is
created when the first styled component is written — is in the rules for
working with code, in the section on how a component talks to its styles.
