import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { systemTemp, testRunTemp } from "./graph.seat.mjs";

// Короткое имя `TEMP` на Windows (`RUNNER~1`) git и сборщик видят длинным, и
// проект, посаженный тестом во временную папку, расходился с самим собой.
// Папка своя на прогон: прерванный прогон оставлял песочницы в общей.
const run = testRunTemp(path.join(systemTemp(), "harness-tests"));
process.once("exit", run.drop);

// Тесты обвязки идут своей командой, вне прогона проекта: обвязка — не код
// проекта. Справочник, раздел «Тесты самого инструмента».
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: [".claude/tools/**/*.test.mjs"],
    environment: "node",
    // Тесты разбирают вывод сверки по секциям — им полный. `CI` конвейера
    // снимает требование ворот, а тесты ждут машину разработчика.
    env: {
      GRAPH_VERIFY_FULL: "1",
      CI: "",
      TMPDIR: run.at,
      TEMP: run.at,
      TMP: run.at,
    },
  },
});
