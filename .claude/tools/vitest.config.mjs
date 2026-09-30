import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Тесты обвязки идут своей командой, вне прогона проекта: обвязка — не код
// проекта. Справочник, раздел «Тесты самого инструмента».
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: [".claude/tools/**/*.test.mjs"],
    environment: "node",
  },
});
