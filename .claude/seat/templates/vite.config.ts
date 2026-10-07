// Почему настройки сборщика и раннера такие —
// `.claude/seat/vite.config-why.md`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Корень прогона назван: сборщик с `root` поддерева сдвигает поиск тестов.
    root: ".",
    environment: "jsdom",
    globals: false,
    // Модули стилей настоящие: под заглушкой слияние карт классов теряет
    // свои классы.
    css: { include: [/.module./] },
    // При `globals: false` уборку после теста регистрирует только этот файл.
    setupFiles: ["./src/tests/setup.ts"],
    // Тесты обвязки идут своей командой: умолчание раннера зашло бы в её папку.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
