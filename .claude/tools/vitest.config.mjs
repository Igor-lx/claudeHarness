import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { systemTemp } from "./graph.seat.mjs";

// Короткое имя `TEMP` на Windows (`RUNNER~1`) git и сборщик видят длинным, и
// проект, посаженный тестом во временную папку, расходился с самим собой.
const temp = systemTemp();

// Тесты обвязки идут своей командой, вне прогона проекта: обвязка — не код
// проекта. Справочник, раздел «Тесты самого инструмента».
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: [".claude/tools/**/*.test.mjs"],
    environment: "node",
    // Тесты разбирают вывод сверки по секциям — им полный.
    env: {
      GRAPH_VERIFY_FULL: "1",
      ...(process.platform === "win32" ? { TEMP: temp, TMP: temp } : {}),
    },
  },
});
