import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// With `globals: false` the library's auto-cleanup never registers, and a second render finds two copies.
afterEach(cleanup);
