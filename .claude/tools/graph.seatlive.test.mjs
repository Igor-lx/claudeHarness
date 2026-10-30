import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  configDebt,
  configField,
  configList,
  debtPlanOf,
  factsWithScopes,
  liveBaseText,
  rulesWithOwnLayout,
  rulesWithout,
  scriptsLive,
  sourceRootsOf,
  tableRows,
  transitionWith,
  withoutAbsentScripts,
} from "./graph.seatlive.mjs";
import {
  eslintLiveText,
  projectConfigName,
  strictConfigsOf,
  vitestLiveText,
} from "./graph.configs.mjs";

const SEEDS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "seat", "templates");
const seed = (name) => fs.readFileSync(path.join(SEEDS, name), "utf8");

// Посадка живого проекта одной командой: чистые половины. Целиком команду
// держит корпус посадок (`graph.modes.corpus.test.mjs`).
describe("живая посадка: база без каркаса", () => {
  it("снимает абзац каркаса, строку таблицы и запись решения с адресом каркаса — и только их", () => {
    const text = [
      "# Карта",
      "",
      "<!-- КАРКАС -->",
      "Каркас приехал семенами.",
      "<!-- /КАРКАС -->",
      "",
      "| Файл | Отвечает за |",
      "| --- | --- |",
      "| `src/app/main.tsx` | монтирование |",
      "| `src/own.ts` | своё |",
      "| `app/tests/App.test.tsx` | тест каркаса |",
      "",
      "**Строгий режим включён.**",
      "Якорь с цитатой: `src/app/main.tsx:6` `StrictMode`.",
      "",
      "**Своё решение.**",
      "Якорь с цитатой: `src/own.ts:1` `own`.",
      "",
    ].join("\n");
    const out = liveBaseText(text, ["src/app/main.tsx", "src/app/tests/App.test.tsx"]);
    expect(out).not.toContain("Каркас приехал");
    expect(out).not.toContain("main.tsx");
    expect(out).not.toContain("App.test.tsx");
    expect(out).toContain("| `src/own.ts` | своё |");
    expect(out).toContain("**Своё решение.**");
    expect(out).not.toMatch(/\n{3}/);
  });

  it("строка таблицы со скриптом, которого у проекта нет, снята; с имеющимся — осталась", () => {
    const text = "| Типы | `npm run typecheck` |\n| Тесты | `npm test` |\n| База | `node graph.mjs verify` |\nпроза `npm run lint`";
    expect(withoutAbsentScripts(text, ["test"])).toBe("| Тесты | `npm test` |\n| База | `node graph.mjs verify` |\nпроза `npm run lint`");
  });

  it("раздел раскладки умолчания в правилах заменён местом под ответ фазы 2", () => {
    const out = rulesWithOwnLayout(seed("CLAUDE.md"));
    expect(out).not.toContain("Раскладка умолчания обвязки, три слоя.");
    expect(out).toContain("<Раскладка проекта:");
    expect(out).toContain("**Законное, хотя со стороны читается нарушением:**");
  });
});

describe("живая посадка: настройка, факты, переход", () => {
  const config = seed("graph.config.mjs");

  it("поле одной строкой и списком в несколько строк заменяется целиком; поля нет — null", () => {
    const one = configField(config, "scenario", "foreign");
    expect(one).toContain('  scenario: "foreign",');
    expect(configList(config, "seeded")).toContain("../eslint.config.mjs");
    const list = configField(config, "seeded", ["00-map.md"]);
    expect(list).toContain('  seeded: ["00-map.md"],');
    expect(configList(list, "seeded")).toBeNull();
    expect(list).not.toContain('    "../.prettierignore",');
    expect(configField(config, "lintConfigOff", null)).toContain("  lintConfigOff: null,");
    expect(configField(config, "zzНетТакого", 1)).toBeNull();
  });

  it("вид долга правится внутри поля `debt`, а не одноимённое поле выше", () => {
    const out = configDebt(config, "map", 7);
    expect(out).toMatch(/\n {2}debt: \{[\s\S]*?\n {4}map: 7,/);
    expect(out).toContain('  map: "00-map.md",');
    expect(configDebt(config, "zz", 1)).toBeNull();
  });

  it("раздел с предметом — живой, причина — замер посадки; прочие строки не тронуты", () => {
    const facts = seed("01-facts.md");
    const out = factsWithScopes(facts, { O: "лист стилей: `App.css` | ещё" });
    expect(out).toContain("| O. Стили и адаптивность | да | замер посадки: лист стилей: `App.css` \\| ещё |");
    expect(out).toContain("| K. Внешние данные | нет |");
  });

  it("строка направления про адрес, которого нет, снята; пример в ограде цел; строк считается без примера", () => {
    const map = seed("00-map.md");
    const head = "| Слой | Что ему запрещено импортировать |";
    expect(tableRows(map, head)).toBe(1);
    const out = rulesWithout(map, ["shared"]);
    expect(tableRows(out, head)).toBe(0);
    expect(out).toContain("| `domain` | `ui`, `app` |  |");
  });

  it("шаги и пункты долга дописываются в свои таблицы, номера продолжают уже стоящие", () => {
    const plan = { heading: "| № | Шаг | Объём | Чем проверяется |", debtHeading: "| № | Расхождение | Сейчас | Держит | План | Цена |" };
    const once = transitionWith(seed("15-transition.md"), plan, [["Карта", "`3` файлов", "«Покрытие карты»"]], [["Раз", "`1`", "«lint»", "п", "ц"]]);
    expect(once).toContain("| 3 | Карта | `3` файлов | «Покрытие карты» |");
    const twice = transitionWith(once, plan, [], [["Два", "`2`", "«test»", "п", "ц"]]);
    expect(twice).toContain("| 1 | Раз | `1` | «lint» | п | ц |");
    expect(twice).toContain("| 2 | Два | `2` | «test» | п | ц |");
  });

  it("долг базы — шагом знания, долг кода — пунктом с тем же числом; нулевой не пишется", () => {
    const { steps, items } = debtPlanOf({ map: 2, tests: 1, types: 5, pins: 0, markers: 3 });
    expect(steps.map((s) => s[2])).toEqual(["«Покрытие карты» и «Покрытие тестов»"]);
    expect(items.map((i) => [i[1], i[2]])).toEqual([
      ["`5`", "«typecheck»"],
      ["`3`", "«Найденное — исправлено, а не отложено»"],
    ]);
  });
});

describe("живая посадка: композиция конфигов и скриптов", () => {
  it("конфиг проекта ложится рядом и узнаётся образцом конфигов корня", () => {
    expect(projectConfigName("eslint.config.js")).toBe("eslint.project.config.js");
    expect(projectConfigName("vitest.config.mts")).toBe("vitest.project.config.mts");
    expect(projectConfigName("stryker.conf.json")).toBe("stryker.project.conf.json");
  });

  it("линт: конфиг проекта первым, общий плагин — обвязки, типы — по строгим копиям", () => {
    const out = eslintLiveText(seed("eslint.config.mjs"), "eslint.project.config.js", ["tsconfig.app.strict.json"]);
    expect(out).toContain('import project from "./eslint.project.config.js";');
    expect(out).toContain("const harness = tseslint.config(");
    expect(out).toContain("shared[name] ?? plugin");
    expect(out).toContain('project: ["./tsconfig.app.strict.json"],');
    expect(out).not.toContain("projectService");
    const bare = eslintLiveText(seed("eslint.config.mjs"), null, ["tsconfig.strict.json"]);
    expect(bare).toContain("export default tseslint.config(");
    expect(bare).not.toContain("import project");
  });

  it("раннер: конфиг проекта основой, исключения обвязки сверху; без конфига проекта — пустая основа", () => {
    expect(vitestLiveText("vite.config.ts")).toContain('import project from "./vite.config.ts";');
    expect(vitestLiveText(null)).toContain("mergeConfig({}, {");
    expect(vitestLiveText(null)).toContain('".claude/**"');
  });

  it("строгость: копия конфига; у решения — копия каждой ссылки, своя память компилятора у той, что её задала", () => {
    const tsconfig = seed("tsconfig.json");
    const plain = strictConfigsOf((n) => (n === "tsconfig.json" ? '{ "include": ["lib"] }' : null), tsconfig);
    expect(plain.call).toBe("tsc -p tsconfig.strict.json");
    expect(plain.files["tsconfig.strict.json"].extends).toBe("./tsconfig.json");
    expect(plain.files["tsconfig.strict.json"].compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(plain.files["tsconfig.strict.json"].compilerOptions.jsx).toBeUndefined();
    const files = {
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }',
      "tsconfig.app.json": '{ "compilerOptions": { /* own */ "tsBuildInfoFile": "./x" } }',
      "tsconfig.node.json": '{ "compilerOptions": {} }',
    };
    const solution = strictConfigsOf((n) => files[n] ?? null, tsconfig);
    expect(solution.call).toBe("tsc -b tsconfig.strict.json");
    expect(solution.lint).toEqual(["tsconfig.app.strict.json", "tsconfig.node.strict.json"]);
    expect(solution.files["tsconfig.app.strict.json"].compilerOptions.tsBuildInfoFile).toBe(
      "./node_modules/.tmp/tsconfig.app.strict.tsbuildinfo",
    );
    expect(solution.files["tsconfig.node.strict.json"].compilerOptions.tsBuildInfoFile).toBeUndefined();
  });

  it("скрипт: та же работа своим вызовом заменяется, другая работа ложится рядом `:own`", () => {
    const { scripts, replaced } = scriptsLive(
      { test: "vitest", check: "npm run lint && tsc", build: "vite build" },
      { test: "vitest run", check: "npm run typecheck && npm test", lint: "eslint ." },
      { test: "^\\s*vitest\\b" },
    );
    expect(scripts).toEqual({
      test: "vitest run",
      check: "npm run typecheck && npm test",
      "check:own": "npm run lint && tsc",
      build: "vite build",
      lint: "eslint .",
    });
    expect(replaced).toEqual([{ name: "test", was: "vitest" }]);
  });

  it("корень исходников: `src`, иначе папки верхнего уровня с кодом, без конфигов корня", () => {
    expect(sourceRootsOf(["src/a.ts", "lib/b.ts"])).toEqual(["src"]);
    expect(sourceRootsOf(["lib/a.ts", "vite.config.ts", "scripts/x.config.js", "README.md"])).toEqual(["lib"]);
  });
});
