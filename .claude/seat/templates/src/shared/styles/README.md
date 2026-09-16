# styles

Style-map helpers. Pure, dependency-free.

## API

- **`mergeStyleMaps(...maps)`** — combine several CSS-module maps by
  concatenating the class strings per key. Lets a component overlay
  caller-supplied `className` overrides on top of its own module map without
  losing the originals. `null` / `undefined` maps and empty values are skipped.

## Usage

```ts
const classNames = useMemo(
  () => (className ? mergeStyleMaps(styles, className) : styles),
  [className],
);
```

## Why the merge is not enough by itself

Merging puts both class names on the same element; which rule wins is then a
specificity race that depends on bundle order. The project settles it in
`src/globals.scss` instead: component rules live inside `@layer`, the caller's
do not, and unlayered styles beat every layer regardless of specificity.

That makes the layer wrappers load-bearing rather than decorative. Drop one and
the caller's override silently becomes a race it may lose, with nothing to
report it.
