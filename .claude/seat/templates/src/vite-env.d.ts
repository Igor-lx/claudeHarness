/// <reference types="vite/client" />

// Type declarations the bundler provides for what the compiler cannot see on
// its own: module stylesheets, static assets, the environment object.
//
// Without this line `import styles from "./X.module.scss"` is an unresolved
// module and the type check fails outright - on the first component that has a
// stylesheet, which is the first one written.
//
// What it declares for a stylesheet is an INDEX SIGNATURE: every name passes,
// including one the sheet does not have. That hole is held by the check
// "Имена классов из кода есть в листе стилей" - see the second kind of the
// language-boundary criterion in the quality policy for why a check and not a
// construction.
