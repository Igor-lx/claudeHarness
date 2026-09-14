// Entry point of the project's sources.
//
// Empty on purpose. The harness is planted before the first line of code, and
// this file exists so that the type checker, the linter and the formatter have
// something to run on from the first day: an empty source root makes the
// compiler exit with "no inputs were found", and a check chain that is red on
// day one is a chain nobody trusts later.
//
// Delete it as soon as there is a real entry point — and name that one in the
// map instead.
export {};
