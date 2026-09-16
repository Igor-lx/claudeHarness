import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount whatever a test rendered, after every test.
//
// The testing library registers this itself - but only when the runner exposes
// its hooks as globals, and this project runs with `globals: false` so that
// every import is visible in the file that uses it. Under that setting the
// automatic cleanup never registers, silently.
//
// What that costs without this file: the second test that renders finds TWO
// copies of the component in the document, and the query fails with "found
// multiple elements". The message points at the query, not at the leftover from
// the previous test, so it reads like a bug in the component. The first test
// file with a single test never shows it.
afterEach(cleanup);
