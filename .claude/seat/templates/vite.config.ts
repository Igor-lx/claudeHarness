// Why these bundler and runner settings:
// `.claude/seat/vite.config-why.md`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Named test root: a subtree bundler `root` moves the test search.
    root: ".",
    environment: "jsdom",
    globals: false,
    // Real CSS modules: under the stub, merging class maps loses the
    // component's own classes.
    css: { include: [/.module./] },
    // With `globals: false`, only this file registers cleanup after a test.
    setupFiles: ["./src/tests/setup.ts"],
    // Harness tests have their own command: the default would collect them.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
